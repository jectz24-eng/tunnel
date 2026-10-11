/**
 * Shared GLSL for the accelerator scenes. Everything glows through additive
 * blending of soft-edged geometry instead of a bloom pass: cheaper, crisper,
 * and it never washes out text overlays.
 */

/** Soft round points with per-point size, colour and alpha; size attenuates with distance. */
export const glowPoints = {
  vertex: /* glsl */ `
    attribute float aSize;
    attribute vec3 aColor;
    attribute float aAlpha;
    uniform float uPixelRatio;
    uniform float uScale;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vColor = aColor;
      vAlpha = aAlpha;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = aSize * uScale * uPixelRatio / max(0.1, -mv.z);
    }
  `,
  fragment: /* glsl */ `
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c);
      if (d > 0.5) discard;
      // Bright core + soft halo.
      float core = smoothstep(0.16, 0.0, d);
      float halo = pow(smoothstep(0.5, 0.0, d), 2.2) * 0.55;
      float a = (core + halo) * vAlpha;
      gl_FragColor = vec4(vColor * (0.65 + core * 1.4), a);
    }
  `,
};

/** Energy flowing around a torus: travelling pulses along the major angle (uv.x). */
export const energyRing = {
  vertex: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      vUv = uv;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragment: /* glsl */ `
    uniform float uTime;
    uniform vec3 uColor;
    uniform vec3 uHot;
    uniform float uIntensity;
    uniform float uSpeed;
    uniform float uPulses;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      float fres = pow(1.0 - abs(dot(vNormal, vView)), 1.6);
      float flow = fract(vUv.x * uPulses - uTime * uSpeed);
      float pulse = smoothstep(0.0, 0.04, flow) * smoothstep(0.38, 0.04, flow);
      float fine = 0.5 + 0.5 * sin(vUv.x * 900.0 - uTime * 6.0);
      vec3 col = mix(uColor * 0.35, uHot, pulse);
      float a = (0.18 + 0.82 * pulse + 0.08 * fine) * (0.35 + fres) * uIntensity;
      gl_FragColor = vec4(col * (0.6 + pulse * 1.2), clamp(a, 0.0, 1.0));
    }
  `,
};

/** Wide additive halo around a tube: fresnel falloff only. */
export const haloShell = {
  vertex: energyRing.vertex,
  fragment: /* glsl */ `
    uniform vec3 uColor;
    uniform float uIntensity;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      float facing = abs(dot(vNormal, vView));
      float a = pow(facing, 3.0) * uIntensity;
      gl_FragColor = vec4(uColor, a);
    }
  `,
};

const noise = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
`;

/**
 * The potential barrier: a wall of plasma. Layered noise, horizontal standing
 * waves, a bright pulsating rim, and two event uniforms:
 *  - uImpact (x,y in uv, time): a ripple from a particle striking the wall
 *  - uBreach: 0..1 opening of a narrow transmission channel (tunneling)
 */
export const plasmaBarrier = {
  vertex: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragment: /* glsl */ `
    uniform float uTime;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform vec3 uFlare;
    uniform vec3 uImpact;
    uniform float uBreach;
    uniform float uIntensity;
    uniform float uDistort;
    varying vec2 vUv;
    ${noise}
    void main() {
      vec2 uv = vUv;
      float t = uTime;
      // Impact ripple.
      float age = t - uImpact.z;
      float dist = distance(uv * vec2(1.6, 1.0), uImpact.xy * vec2(1.6, 1.0));
      float ripple = age > 0.0 && age < 2.5 ? sin(dist * 46.0 - age * 14.0) * exp(-age * 1.6) * exp(-dist * 3.5) : 0.0;
      vec2 p = uv + vec2(ripple * 0.02 * uDistort, 0.0);
      float n1 = snoise(vec2(p.x * 3.0, p.y * 2.2 - t * 0.35));
      float n2 = snoise(vec2(p.x * 9.0 + t * 0.2, p.y * 7.0 + t * 0.6));
      float bands = 0.5 + 0.5 * sin(p.y * 60.0 + n1 * 3.0 + t * 1.8);
      float field = 0.45 + 0.35 * n1 + 0.2 * n2;
      vec3 col = mix(uColorA, uColorB, smoothstep(0.2, 0.9, field));
      // Edges: bright rim on all sides, fading toward the centre.
      float edgeX = smoothstep(0.08, 0.0, min(uv.x, 1.0 - uv.x));
      float edgeY = smoothstep(0.04, 0.0, min(uv.y, 1.0 - uv.y));
      float rim = max(edgeX, edgeY) * (0.7 + 0.3 * sin(t * 3.0));
      // Vertical falloff so the wall feels like a field, not a panel.
      float body = smoothstep(0.0, 0.18, uv.y) * smoothstep(1.0, 0.82, uv.y);
      // Vertical filaments drifting through the field.
      float fil = pow(max(0.0, sin(p.x * 34.0 + n1 * 2.0 + t * 0.7)), 18.0) * 0.5;
      float alpha = (0.12 + 0.34 * field * bands + fil) * body + rim * 0.95 + abs(ripple) * 0.9;
      col = mix(col, uFlare, rim * 0.35 + fil * 0.4);
      // Tunneling channel.
      float channel = uBreach * exp(-pow((uv.y - 0.5) * 9.0, 2.0)) * (0.6 + 0.4 * sin(uv.x * 40.0 - t * 20.0));
      col = mix(col, uFlare, clamp(channel + abs(ripple) * 0.8, 0.0, 1.0));
      alpha += channel * 0.8;
      gl_FragColor = vec4(col * (0.8 + bands * 0.5), clamp(alpha * uIntensity, 0.0, 1.0));
    }
  `,
};

/** Expanding ring shockwave on a plane (success pulse). */
export const shockwave = {
  vertex: plasmaBarrier.vertex,
  fragment: /* glsl */ `
    uniform float uProgress;
    uniform vec3 uColor;
    varying vec2 vUv;
    void main() {
      float d = distance(vUv, vec2(0.5)) * 2.0;
      float r = uProgress;
      float ring = smoothstep(0.06, 0.0, abs(d - r)) * (1.0 - uProgress);
      float fill = smoothstep(r, 0.0, d) * 0.15 * (1.0 - uProgress);
      gl_FragColor = vec4(uColor, ring + fill);
    }
  `,
};

/** Large camera-facing radial gradient: atmospheric light volume. */
export const softLight = {
  vertex: plasmaBarrier.vertex,
  fragment: /* glsl */ `
    uniform vec3 uColor;
    uniform float uIntensity;
    varying vec2 vUv;
    void main() {
      float d = distance(vUv, vec2(0.5)) * 2.0;
      float a = pow(max(0.0, 1.0 - d), 2.6) * uIntensity;
      gl_FragColor = vec4(uColor, a);
    }
  `,
};
