"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type MutableRefObject, type Ref } from "react";
import * as THREE from "three";
import { TimerDriver, useTimerDriven } from "./driver";
import { energyRing, glowPoints, haloShell, plasmaBarrier, softLight } from "./shaders";

/**
 * The circular particle accelerator. In "decorative" mode particles are
 * spawned and resolved at random (the page labels this as a visual effect).
 * In "live" mode nothing is invented: particles appear only when the page
 * calls `launch()` for a real indexed event.
 */
export interface RingApi {
  /** outcome "orbit" keeps circulating until it fades; "tunnel"/"reflect" resolve at the barrier. */
  launch: (p: { color: string; outcome: "tunnel" | "reflect" | "orbit"; delay?: number }) => void;
}

export interface RingProps {
  mode: "decorative" | "live";
  apiRef?: Ref<RingApi>;
  /** 0..1 scroll progress through the hero: drives the camera approach. */
  scrollRef?: MutableRefObject<number>;
  particles?: number;
  dpr?: [number, number];
  reducedMotion?: boolean;
  className?: string;
  /** Camera framing preset. */
  framing?: "hero" | "panel";
  /**
   * Labels pinned to points of the scene. Each frame the anchor is projected
   * to the screen and the matching element (by id) is moved there, faded by
   * its scroll window. Updated imperatively, so React never re-renders.
   */
  annotations?: Annotation[];
  annotationRefs?: MutableRefObject<Record<string, HTMLElement | null>>;
}

export interface Annotation {
  id: string;
  anchor: AnchorName;
  /** Scroll progress range [in, out] in which the label is visible. */
  window: [number, number];
  /** Which side the label card opens to; "auto" picks the side facing the screen centre. */
  side?: "auto" | "left" | "right";
}

export type AnchorName = "ring" | "ringBack" | "magnets" | "core" | "conduits" | "barrier" | "barrierTop" | "width" | "pylon" | "transmission";

const R = 4.2;
const BARRIER_THETA = Math.PI * 0.36;
const TRAIL = 10;
const C = {
  cyan: new THREE.Color("#00D9FF"),
  ion: new THREE.Color("#2864FF"),
  violet: new THREE.Color("#885BFF"),
  flare: new THREE.Color("#EAFBFF"),
  amber: new THREE.Color("#F0A64B"),
};

function glowMaterial(pixelRatio: number, scale = 260) {
  return new THREE.ShaderMaterial({
    vertexShader: glowPoints.vertex,
    fragmentShader: glowPoints.fragment,
    uniforms: { uPixelRatio: { value: pixelRatio }, uScale: { value: scale } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

type PState = 0 | 1 | 2 | 3; // 0 dead, 1 circulating, 2 passed (tunneled), 3 reflected
interface Pool {
  theta: Float32Array;
  speed: Float32Array;
  dir: Float32Array;
  y: Float32Array;
  life: Float32Array;
  state: Uint8Array;
  outcome: Uint8Array; // 0 orbit, 1 tunnel, 2 reflect
  laps: Float32Array;
  delay: Float32Array;
  color: Float32Array;
  trail: Float32Array;
}

function makePool(n: number): Pool {
  return {
    theta: new Float32Array(n),
    speed: new Float32Array(n),
    dir: new Float32Array(n).fill(1),
    y: new Float32Array(n),
    life: new Float32Array(n),
    state: new Uint8Array(n),
    outcome: new Uint8Array(n),
    laps: new Float32Array(n),
    delay: new Float32Array(n),
    color: new Float32Array(n * 3),
    trail: new Float32Array(n * TRAIL * 3),
  };
}

const smooth = (x: number) => x * x * (3 - 2 * x);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Hero camera path: [progress, position, look-at target]. */
function heroKeyframes(barrier: THREE.Vector3, wide: boolean, narrow: boolean) {
  const tangent = new THREE.Vector3(-Math.sin(BARRIER_THETA), 0, Math.cos(BARRIER_THETA));
  const radial = new THREE.Vector3(Math.cos(BARRIER_THETA), 0, Math.sin(BARRIER_THETA));
  const k = narrow ? 1.35 : 1;
  const up = (v: THREE.Vector3, y: number) => v.clone().setY(y);
  return [
    { p: 0, pos: narrow ? new THREE.Vector3(0, 6.5, 15.5) : new THREE.Vector3(-0.5, 4.4, 14.2), target: wide ? new THREE.Vector3(-3.4, -1.0, 0.6) : new THREE.Vector3(0, -0.6, 0) },
    // high overview of the whole machine
    { p: 0.28, pos: new THREE.Vector3(-6.2 * k, 7.6 * k, 8.4 * k), target: new THREE.Vector3(0.2, -0.4, 0.4) },
    // side view of the barrier: the beam visibly passes through its width
    { p: 0.52, pos: up(barrier.clone().addScaledVector(radial, 4.6 * k).addScaledVector(tangent, 2.2 * k), 1.5 * k), target: barrier.clone().addScaledVector(radial, -0.4) },
    // down the beam line, facing the barrier
    { p: 0.74, pos: up(barrier.clone().addScaledVector(tangent, -4.2 * k).addScaledVector(radial, 0.9), 0.75), target: barrier.clone().addScaledVector(tangent, 1.5) },
    // into the wall: the frame fills with the plasma field, then the page takes over
    { p: 0.86, pos: up(barrier.clone().addScaledVector(tangent, -0.75), 0.35), target: barrier.clone().addScaledVector(tangent, 3).setY(0.35) },
  ];
}

function Scene({ mode, apiRef, scrollRef, particles = 160, reducedMotion, framing = "hero", annotations, annotationRefs }: RingProps) {
  const { gl, camera, pointer, size } = useThree();
  const pr = gl.getPixelRatio();
  const pool = useMemo(() => makePool(particles), [particles]);
  const impact = useRef({ t: -10, breach: 0 });
  const arcs = useRef<{ t: number; seed: number }[]>([]);
  const clock = useRef(0);
  const spawnTimer = useRef(0);

  // ---------------------------------------------------------------- materials
  const ringMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: energyRing.vertex,
        fragmentShader: energyRing.fragment,
        uniforms: { uTime: { value: 0 }, uColor: { value: C.ion }, uHot: { value: C.cyan }, uIntensity: { value: 1 }, uSpeed: { value: 0.12 }, uPulses: { value: 6 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const haloMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: haloShell.vertex,
        fragmentShader: haloShell.fragment,
        uniforms: { uColor: { value: C.ion }, uIntensity: { value: 0.22 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const barrierMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: plasmaBarrier.vertex,
        fragmentShader: plasmaBarrier.fragment,
        uniforms: {
          uTime: { value: 0 },
          uColorA: { value: C.violet },
          uColorB: { value: C.ion },
          uFlare: { value: C.flare },
          uImpact: { value: new THREE.Vector3(0.5, 0.5, -10) },
          uBreach: { value: 0 },
          uIntensity: { value: 1 },
          uDistort: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const lightMats = useMemo(
    () =>
      [C.ion, C.violet, C.cyan].map(
        (c, i) =>
          new THREE.ShaderMaterial({
            vertexShader: softLight.vertex,
            fragmentShader: softLight.fragment,
            uniforms: { uColor: { value: c }, uIntensity: { value: [0.16, 0.12, 0.1][i] } },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
      ),
    [],
  );
  const particleMat = useMemo(() => glowMaterial(pr, 440), [pr]);
  const dustMat = useMemo(() => glowMaterial(pr, 90), [pr]);

  // ---------------------------------------------------------------- geometry
  const ringGeo = useMemo(() => new THREE.TorusGeometry(R, 0.05, 16, 320), []);
  const haloGeo = useMemo(() => new THREE.TorusGeometry(R, 0.28, 24, 200), []);
  const markGeo = useMemo(() => new THREE.TorusGeometry(R + 1.15, 0.006, 4, 256), []);
  const railGeo = useMemo(() => new THREE.TorusGeometry(R, 0.012, 6, 256), []);
  const innerGeo = useMemo(() => new THREE.TorusGeometry(R - 0.85, 0.006, 4, 256), []);
  const spokeGeo = useMemo(() => new THREE.CylinderGeometry(0.012, 0.012, R - 0.5, 6, 1, true), []);

  /** Dipole magnets as C-yokes: a jaw above and below the beam, which stays visible between them. */
  const magnets = useMemo(() => {
    const n = 72;
    const geo = new THREE.BoxGeometry(0.42, 0.075, 0.12);
    const mat = new THREE.MeshStandardMaterial({ color: "#121b27", metalness: 0.92, roughness: 0.32, emissive: "#071022", emissiveIntensity: 0.6 });
    const mesh = new THREE.InstancedMesh(geo, mat, n * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let k = 0;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      if (Math.abs(((th - BARRIER_THETA + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.2) continue;
      q.setFromEuler(new THREE.Euler(0, -th, 0));
      for (const y of [0.13, -0.13]) {
        m.compose(new THREE.Vector3(Math.cos(th) * R, y, Math.sin(th) * R), q, new THREE.Vector3(1, 1, 1));
        mesh.setMatrixAt(k++, m);
      }
    }
    mesh.count = k;
    return mesh;
  }, []);

  /**
   * Additive glow shells over each magnet jaw. A magnet lights up as a
   * particle passes through it, then fades: the beam visibly runs the ring.
   */
  const magnetGlow = useMemo(() => {
    const n = 72;
    const geo = new THREE.BoxGeometry(0.43, 0.08, 0.125);
    const mat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geo, mat, n * 2);
    const slots: number[][] = Array.from({ length: n }, () => []);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let k = 0;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      if (Math.abs(((th - BARRIER_THETA + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.2) continue;
      q.setFromEuler(new THREE.Euler(0, -th, 0));
      for (const y of [0.13, -0.13]) {
        m.compose(new THREE.Vector3(Math.cos(th) * R, y, Math.sin(th) * R), q, new THREE.Vector3(1, 1, 1));
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, new THREE.Color(0, 0, 0));
        slots[i].push(k++);
      }
    }
    mesh.count = k;
    return { mesh, slots, level: new Float32Array(n), n };
  }, []);
  const glowColor = useMemo(() => new THREE.Color(), []);

  /** Expanding energy pulses: two from the core across the ring plane, three tunneling shockwaves at the barrier. */
  const pulseGeo = useMemo(() => new THREE.TorusGeometry(1, 0.012, 6, 160), []);
  const pulses = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => {
        const mat = new THREE.MeshBasicMaterial({ color: i < 2 ? "#2864FF" : "#EAFBFF", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
        return { mesh: new THREE.Mesh(pulseGeo, mat), t0: i < 2 ? -i * 2.2 : -10 };
      }),
    [pulseGeo],
  );
  const nextShock = useRef(0);

  /** Energy motes rising from the quantum core. */
  const MOTES = 48;
  const moteGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const c = new Float32Array(MOTES * 3);
    for (let i = 0; i < MOTES; i++) c.set(i % 3 ? [0, 0.85, 1] : [0.92, 0.98, 1], i * 3);
    g.setAttribute("aColor", new THREE.BufferAttribute(c, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(MOTES).map(() => 0.7 + Math.random() * 0.9), 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(MOTES), 1).setUsage(THREE.DynamicDrawUsage));
    return g;
  }, []);

  const ticks = useMemo(() => {
    const n = 120;
    const geo = new THREE.BoxGeometry(0.012, 0.012, 0.22);
    const mat = new THREE.MeshBasicMaterial({ color: "#2a3d55", transparent: true, opacity: 0.8 });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      const len = i % 10 === 0 ? 2.2 : 1;
      m.compose(new THREE.Vector3(Math.cos(th) * (R + 1.15), 0, Math.sin(th) * (R + 1.15)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -th + Math.PI / 2, 0)), new THREE.Vector3(1, 1, len));
      mesh.setMatrixAt(i, m);
    }
    return mesh;
  }, []);

  const particleGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = particles * (TRAIL + 1);
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    return g;
  }, [particles]);

  const dustGeo = useMemo(() => {
    const n = Math.round(particles * 2.5);
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const alpha = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = 2 + Math.random() * 9;
      const th = Math.random() * Math.PI * 2;
      pos.set([Math.cos(th) * r, (Math.random() - 0.5) * 5, Math.sin(th) * r], i * 3);
      const c = [C.cyan, C.ion, C.violet][i % 3];
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = 0.5 + Math.random() * 1.2;
      alpha[i] = 0.12 + Math.random() * 0.25;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    return g;
  }, [particles]);

  /** A few large, faint glow points around the quantum core. */
  const coreGlowGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0.02, 0]), 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array([0.92, 0.98, 1, 0, 0.85, 1, 0.16, 0.39, 1]), 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array([6, 14, 30]), 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array([0.9, 0.35, 0.18]), 1));
    return g;
  }, []);

  const arcGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 12 * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    return g;
  }, []);
  const arcMat = useMemo(() => new THREE.LineBasicMaterial({ color: C.flare, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }), []);

  useEffect(
    () => () => {
      [ringMat, haloMat, barrierMat, particleMat, dustMat, arcMat, ...lightMats].forEach((m) => m.dispose());
      [ringGeo, haloGeo, markGeo, railGeo, innerGeo, spokeGeo, particleGeo, dustGeo, arcGeo, coreGlowGeo].forEach((g) => g.dispose());
      magnets.geometry.dispose();
      magnetGlow.mesh.geometry.dispose();
      (magnetGlow.mesh.material as THREE.Material).dispose();
      pulseGeo.dispose();
      pulses.forEach((pl) => (pl.mesh.material as THREE.Material).dispose());
      moteGeo.dispose();
      (magnets.material as THREE.Material).dispose();
      ticks.geometry.dispose();
      (ticks.material as THREE.Material).dispose();
    },
    [ringMat, haloMat, barrierMat, particleMat, dustMat, arcMat, lightMats, ringGeo, haloGeo, markGeo, railGeo, innerGeo, spokeGeo, particleGeo, dustGeo, arcGeo, coreGlowGeo, magnets, ticks],
  );

  // ---------------------------------------------------------------- spawning
  const spawn = (color: THREE.Color, outcome: 0 | 1 | 2, delay = 0) => {
    for (let i = 0; i < particles; i++) {
      if (pool.state[i] !== 0) continue;
      pool.state[i] = 1;
      pool.theta[i] = BARRIER_THETA + 0.4 + Math.random() * 0.3;
      pool.speed[i] = 0.55 + Math.random() * 0.45;
      pool.dir[i] = 1;
      pool.y[i] = (Math.random() - 0.5) * 0.12;
      pool.life[i] = 1;
      pool.outcome[i] = outcome;
      pool.laps[i] = outcome === 0 ? 1.2 + Math.random() : 0.75 + Math.random() * 0.5;
      pool.delay[i] = delay;
      pool.color.set([color.r, color.g, color.b], i * 3);
      for (let k = 0; k < TRAIL; k++) pool.trail.set([NaN, 0, 0], (i * TRAIL + k) * 3);
      return;
    }
  };

  // Start with particles already spread around the ring, so the first frame looks alive.
  useEffect(() => {
    if (mode !== "decorative") return;
    for (let i = 0; i < Math.min(28, particles); i++) {
      spawn([C.cyan, C.ion, C.violet][i % 3], 0);
      pool.theta[i] = (i / 28) * Math.PI * 2;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion, mode]);

  useImperativeHandle(apiRef, () => ({
    launch: ({ color, outcome, delay }) => spawn(new THREE.Color(color), outcome === "orbit" ? 0 : outcome === "tunnel" ? 1 : 2, delay ?? 0),
  }));

  const barrierPos = new THREE.Vector3(Math.cos(BARRIER_THETA) * R, 0, Math.sin(BARRIER_THETA) * R);
  const barrierQuat = useMemo(() => new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -BARRIER_THETA, 0)), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const camTarget = useMemo(() => new THREE.Vector3(), []);
  const spokes = useMemo(() => Array.from({ length: 6 }, (_, i) => (i / 6) * Math.PI * 2 + 0.3), []);
  const lightRefs = useRef<(THREE.Mesh | null)[]>([]);
  const markRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  const ticksRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const dustRef = useRef<THREE.Points>(null);
  const narrow = size.width < 640;
  const smoothed = useRef(0);
  const keyframes = useMemo(() => heroKeyframes(barrierPos, size.width >= 1024, size.width < 640), [size.width]);
  const wantPos = useMemo(() => new THREE.Vector3(), []);
  const wantTarget = useMemo(() => new THREE.Vector3(), []);
  const curTarget = useRef<THREE.Vector3 | null>(null);
  const proj = useMemo(() => new THREE.Vector3(), []);
  const anchors = useMemo(() => {
    const onRing = (th: number, y = 0.12, r = R) => new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
    const radial = new THREE.Vector3(Math.cos(BARRIER_THETA), 0, Math.sin(BARRIER_THETA));
    const conduit = 0.3 + (Math.PI * 2) / 6;
    return {
      ring: onRing(Math.PI * 1.08, 0.08),
      magnets: onRing(Math.PI * 0.78, 0.2),
      core: new THREE.Vector3(0, 0.1, 0),
      conduits: new THREE.Vector3(Math.cos(conduit) * R * 0.55, 0, Math.sin(conduit) * R * 0.55),
      barrier: barrierPos.clone().setY(1.0),
      barrierTop: barrierPos.clone().setY(1.3),
      ringBack: onRing(-Math.PI * 0.58, 0.12),
      width: barrierPos.clone().setY(-0.9),
      pylon: barrierPos.clone().addScaledVector(radial, 0.78).setY(0.6),
      transmission: onRing(BARRIER_THETA + 0.42, 0.1),
    } satisfies Record<AnchorName, THREE.Vector3>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((state, rawDt) => {
    // Reduced motion = a calmer scene (slower, no camera sway), not a frozen one.
    const dt = Math.min(rawDt, 1 / 30) * (reducedMotion ? 0.45 : 1);
    clock.current += dt;
    const t = clock.current;
    ringMat.uniforms.uTime.value = t;
    barrierMat.uniforms.uTime.value = t;

    // Camera. Scroll progress is damped (frame-rate independent) so wheel steps
    // become one continuous glide, then mapped onto the keyframed path.
    const frameDt = Math.min(rawDt, 1 / 20);
    const raw = scrollRef?.current ?? 0;
    smoothed.current = reducedMotion ? raw : smoothed.current + (raw - smoothed.current) * (1 - Math.exp(-frameDt * 4.5));
    const s = smoothed.current;
    if (framing === "hero") {
      let i = 0;
      while (i < keyframes.length - 2 && s > keyframes[i + 1].p) i++;
      const a = keyframes[i];
      const b = keyframes[i + 1];
      const u = smooth(Math.min(1, Math.max(0, (s - a.p) / (b.p - a.p))));
      wantPos.copy(a.pos).lerp(b.pos, u);
      wantTarget.copy(a.target).lerp(b.target, u);
      const sway = 1 - Math.min(1, s * 1.6);
      wantPos.x += pointer.x * 0.7 * sway;
      wantPos.y += pointer.y * 0.45 * sway;
    } else {
      wantPos.set(pointer.x * 0.5, 5.2 + pointer.y * 0.3, 12.5);
      wantTarget.set(0, 0, 0);
    }
    // Slow drift around the machine so the scene never sits still.
    if (!reducedMotion) wantPos.applyAxisAngle(Y_AXIS, framing === "hero" ? Math.sin(t * 0.09) * 0.16 : t * 0.045);
    const follow = 1 - Math.exp(-frameDt * 6);
    camera.position.lerp(wantPos, follow);
    if (!curTarget.current) curTarget.current = wantTarget.clone();
    curTarget.current.lerp(wantTarget, follow);
    camTarget.copy(curTarget.current);
    camera.lookAt(camTarget);

    // Pinned labels: project each anchor and move its element there.
    if (annotations && annotationRefs) {
      const w = size.width;
      const h = size.height;
      for (const an of annotations) {
        const el = annotationRefs.current[an.id];
        if (!el) continue;
        const [i0, i1] = an.window;
        const fade = Math.min(smooth(Math.min(1, Math.max(0, (s - i0) / 0.06))), smooth(Math.min(1, Math.max(0, (i1 - s) / 0.06))));
        proj.copy(anchors[an.anchor]).project(camera);
        const visible = proj.z < 1 && Math.abs(proj.x) < 0.95 && Math.abs(proj.y) < 0.92;
        const x = (proj.x * 0.5 + 0.5) * w;
        const y = (-proj.y * 0.5 + 0.5) * h;
        const o = visible ? fade : 0;
        el.style.opacity = o.toFixed(3);
        // Whole pixels: fractional positions blur the label text.
        el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        el.style.visibility = o > 0.01 ? "visible" : "hidden";
        // Preferred side, flipped if the card would leave the screen.
        let side = an.side && an.side !== "auto" ? an.side : x > w * 0.5 ? "left" : "right";
        const card = (el.lastElementChild as HTMLElement | null)?.offsetWidth ?? 0;
        const reach = card + (w < 640 ? 56 : 72) + 8;
        const fits = (sd: string) => (sd === "left" ? x - reach >= 0 : x + reach <= w);
        if (!fits(side)) side = fits(side === "left" ? "right" : "left") ? (side === "left" ? "right" : "left") : x > w / 2 ? "left" : "right";
        el.dataset.side = side;
      }
    }

    // Rotating magnetic structures.
    if (markRef.current) markRef.current.rotation.z += dt * 0.03;
    if (innerRef.current) innerRef.current.rotation.z -= dt * 0.05;
    if (ticksRef.current) ticksRef.current.rotation.y += dt * 0.025;
    if (dustRef.current) dustRef.current.rotation.y += dt * 0.012;
    if (coreRef.current) coreRef.current.scale.setScalar(1 + Math.sin(t * 2.2) * 0.06);
    lightRefs.current.forEach((m) => m?.quaternion.copy(camera.quaternion));

    // Decorative mode: keep a steady stream, resolved at random (visual effect only).
    if (mode === "decorative") {
      spawnTimer.current -= dt;
      if (spawnTimer.current <= 0) {
        spawnTimer.current = 0.07 + Math.random() * 0.12;
        const c = [C.cyan, C.ion, C.violet][Math.floor(Math.random() * 3)];
        spawn(c, Math.random() < 0.38 ? 1 : 2);
      }
    }

    // Impact / breach decay.
    impact.current.breach = Math.max(0, impact.current.breach - dt * 1.8);
    barrierMat.uniforms.uBreach.value = impact.current.breach;

    // ---- particles
    const pos = particleGeo.attributes.position.array as Float32Array;
    const col = particleGeo.attributes.aColor.array as Float32Array;
    const siz = particleGeo.attributes.aSize.array as Float32Array;
    const alp = particleGeo.attributes.aAlpha.array as Float32Array;
    for (let i = 0; i < particles; i++) {
      const base3 = i * (TRAIL + 1);
      if (pool.state[i] === 0) {
        for (let k = 0; k <= TRAIL; k++) alp[base3 + k] = 0;
        continue;
      }
      if (pool.delay[i] > 0) {
        pool.delay[i] -= dt;
        for (let k = 0; k <= TRAIL; k++) alp[base3 + k] = 0;
        continue;
      }
      const prev = pool.theta[i];
      pool.theta[i] += pool.dir[i] * pool.speed[i] * dt * (pool.state[i] === 3 ? 0.55 : 1);
      if (pool.state[i] === 1) {
        // Crossing the barrier angle (mod 2π) resolves the particle.
        const crossed = Math.floor((prev - BARRIER_THETA) / (Math.PI * 2)) !== Math.floor((pool.theta[i] - BARRIER_THETA) / (Math.PI * 2));
        if (crossed) {
          pool.laps[i] -= 1;
          if (pool.laps[i] <= 0 && pool.outcome[i] !== 0) {
            const y = 0.5 + pool.y[i] * 2;
            if (pool.outcome[i] === 1) {
              pool.state[i] = 2;
              impact.current.breach = 1;
              pulses[2 + (nextShock.current++ % 3)].t0 = t;
              pool.color.set([C.flare.r, C.flare.g, C.flare.b], i * 3);
            } else {
              pool.state[i] = 3;
              pool.dir[i] = -1;
              pool.color.set([C.amber.r, C.amber.g, C.amber.b], i * 3);
            }
            barrierMat.uniforms.uImpact.value.set(0.5, y, t);
            if (arcs.current.length < 3 && Math.random() < 0.5) arcs.current.push({ t, seed: Math.random() * 1000 });
          } else if (pool.laps[i] <= 0) {
            pool.state[i] = 2;
          }
        }
      } else {
        pool.life[i] -= dt * (pool.state[i] === 3 ? 0.9 : 0.45);
        if (pool.life[i] <= 0) pool.state[i] = 0;
      }
      const th = pool.theta[i];
      const wobble = Math.sin(t * 9 + i) * 0.015;
      const x = Math.cos(th) * (R + wobble);
      const z = Math.sin(th) * (R + wobble);
      const y = pool.y[i] + wobble;
      // shift trail
      const tb = i * TRAIL * 3;
      pool.trail.copyWithin(tb + 3, tb, tb + (TRAIL - 1) * 3);
      pool.trail[tb] = x;
      pool.trail[tb + 1] = y;
      pool.trail[tb + 2] = z;
      const life = Math.max(0, pool.life[i]);
      const cr = pool.color[i * 3], cg = pool.color[i * 3 + 1], cb = pool.color[i * 3 + 2];
      pos.set([x, y, z], base3 * 3);
      col.set([cr, cg, cb], base3 * 3);
      siz[base3] = pool.state[i] === 2 ? 3.2 : 2.4;
      alp[base3] = life;
      for (let k = 0; k < TRAIL; k++) {
        const j = base3 + 1 + k;
        const tx = pool.trail[tb + k * 3];
        if (Number.isNaN(tx)) {
          alp[j] = 0;
          continue;
        }
        pos.set([tx, pool.trail[tb + k * 3 + 1], pool.trail[tb + k * 3 + 2]], j * 3);
        col.set([cr, cg, cb], j * 3);
        siz[j] = 2.1 * (1 - k / TRAIL);
        alp[j] = life * 0.7 * (1 - k / TRAIL);
      }
    }
    particleGeo.attributes.position.needsUpdate = true;
    particleGeo.attributes.aColor.needsUpdate = true;
    particleGeo.attributes.aSize.needsUpdate = true;
    particleGeo.attributes.aAlpha.needsUpdate = true;

    // ---- magnets light up as particles pass
    const gl = magnetGlow;
    for (let i = 0; i < gl.n; i++) gl.level[i] *= Math.exp(-dt * 2.6);
    for (let i = 0; i < particles; i++) {
      if (pool.state[i] === 0 || pool.delay[i] > 0) continue;
      const th = ((pool.theta[i] % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const slot = Math.round(th / ((Math.PI * 2) / gl.n)) % gl.n;
      gl.level[slot] = Math.max(gl.level[slot], pool.state[i] === 3 ? 0.4 : 0.75);
    }
    for (let i = 0; i < gl.n; i++) {
      const v = gl.level[i];
      glowColor.setRGB(v * 0.01, v * 0.22, v * 0.42);
      for (const k of gl.slots[i]) gl.mesh.setColorAt(k, glowColor);
    }
    if (gl.mesh.instanceColor) gl.mesh.instanceColor.needsUpdate = true;

    // ---- core pulses (radar sweep across the ring plane) and tunneling shockwaves
    pulses.forEach((pl, i) => {
      const m = pl.mesh.material as THREE.MeshBasicMaterial;
      if (i < 2) {
        const age = (((t - pl.t0) % 4.4) + 4.4) % 4.4;
        const u = age / 4.4;
        pl.mesh.position.set(0, 0, 0);
        pl.mesh.rotation.set(Math.PI / 2, 0, 0);
        pl.mesh.scale.setScalar(0.2 + u * (R - 0.1));
        m.opacity = (reducedMotion ? 0.3 : 0.55) * Math.sin(u * Math.PI) * (1 - u * 0.5);
      } else {
        const u = (t - pl.t0) / 1.1;
        pl.mesh.position.copy(barrierPos).setY(0);
        pl.mesh.quaternion.copy(barrierQuat);
        pl.mesh.scale.setScalar(0.15 + Math.min(1, Math.max(0, u)) * 1.6);
        m.opacity = u >= 0 && u <= 1 ? 0.9 * (1 - u) : 0;
      }
    });

    // ---- motes rising from the core
    const mp = moteGeo.attributes.position.array as Float32Array;
    const ma = moteGeo.attributes.aAlpha.array as Float32Array;
    for (let i = 0; i < MOTES; i++) {
      const u = (t * 0.12 + i / MOTES) % 1;
      const ang = i * 2.39996 + t * 0.4;
      const r = 0.12 + u * 0.9 + (i % 5) * 0.04;
      mp[i * 3] = Math.cos(ang) * r;
      mp[i * 3 + 1] = u * 3.2 - 0.2;
      mp[i * 3 + 2] = Math.sin(ang) * r;
      ma[i] = Math.sin(u * Math.PI) * (reducedMotion ? 0.45 : 0.7);
    }
    moteGeo.attributes.position.needsUpdate = true;
    moteGeo.attributes.aAlpha.needsUpdate = true;

    // ---- electrical arcs at the barrier
    arcs.current = arcs.current.filter((a) => t - a.t < 0.35);
    const ap = arcGeo.attributes.position.array as Float32Array;
    ap.fill(0);
    arcs.current.forEach((a, n) => {
      let px = barrierPos.x, py = 0.9, pz = barrierPos.z;
      for (let k = 0; k < 12; k++) {
        const s1 = Math.sin(a.seed + k * 12.9898) * 43758.5453;
        const jitter = (s1 - Math.floor(s1) - 0.5) * 0.35;
        const nx = barrierPos.x + jitter, ny = 0.9 - (k + 1) * 0.15, nz = barrierPos.z + jitter * 0.6;
        ap.set([px, py, pz, nx, ny, nz], (n * 12 + k) * 6);
        px = nx; py = ny; pz = nz;
      }
    });
    arcGeo.attributes.position.needsUpdate = true;
    arcMat.opacity = arcs.current.length ? 0.85 : 0;
  });


  return (
    <>
      <fog attach="fog" args={["#05070B", 12, 30]} />
      <ambientLight intensity={0.12} />
      <directionalLight position={[-4, 8, -6]} intensity={0.9} color="#9fdcff" />
      <pointLight position={[0, 0.6, 0]} intensity={4.5} distance={9} decay={1.6} color="#2864FF" />
      <pointLight position={[barrierPos.x, 1.0, barrierPos.z]} intensity={5} distance={4.5} decay={1.6} color="#885BFF" />

      {/* atmospheric light volumes */}
      {lightMats.map((m, i) => (
        <mesh key={i} ref={(el) => void (lightRefs.current[i] = el)} material={m} position={[[0, 0, 0], [barrierPos.x, 0.5, barrierPos.z], [-2, -0.5, -3]][i] as [number, number, number]}>
          <planeGeometry args={[[20, 7, 12][i], [20, 7, 12][i]]} />
        </mesh>
      ))}

      <group rotation={[0, 0, 0]}>
        {/* main ring + halo */}
        <mesh geometry={ringGeo} material={ringMat} rotation={[Math.PI / 2, 0, 0]} />
        <mesh geometry={haloGeo} material={haloMat} rotation={[Math.PI / 2, 0, 0]} />
        {/* vacuum chamber rails */}
        {[0.075, -0.075].map((y) => (
          <mesh key={y} geometry={railGeo} rotation={[Math.PI / 2, 0, 0]} position={[0, y, 0]}>
            <meshStandardMaterial color="#1b2838" metalness={0.95} roughness={0.25} />
          </mesh>
        ))}
        {/* magnets (dipoles) */}
        <primitive object={magnets} />
        <primitive object={magnetGlow.mesh} />
        {pulses.map((pl, i) => (
          <primitive key={i} object={pl.mesh} />
        ))}
        <points geometry={moteGeo} material={dustMat} frustumCulled={false} />
        {/* markings */}
        <mesh ref={markRef} geometry={markGeo} rotation={[Math.PI / 2, 0, 0]}>
          <meshBasicMaterial color="#1f3247" transparent opacity={0.9} />
        </mesh>
        <mesh ref={innerRef} geometry={innerGeo} rotation={[Math.PI / 2, 0, 0]}>
          <meshBasicMaterial color="#182638" transparent opacity={0.9} />
        </mesh>
        <group ref={ticksRef}>
          <primitive object={ticks} />
        </group>
        {/* energy conduits from the quantum core */}
        {spokes.map((th, i) => (
          <mesh key={i} geometry={spokeGeo} material={ringMat} position={[Math.cos(th) * (R / 2), -0.02, Math.sin(th) * (R / 2)]} rotation={[0, -th, Math.PI / 2]} />
        ))}
        <mesh ref={coreRef}>
          <sphereGeometry args={[0.09, 32, 16]} />
          <meshBasicMaterial color="#EAFBFF" />
        </mesh>
        <points geometry={coreGlowGeo} material={dustMat} />
        {/* the potential barrier */}
        {/* barrier volume of width a: entry and exit faces, emitter pylons */}
        <group position={barrierPos} quaternion={barrierQuat}>
          {[-0.18, 0.18].map((x) => (
            <mesh key={x} material={barrierMat} position={[0, 0, x]}>
              <planeGeometry args={[1.5, 2.4, 1, 1]} />
            </mesh>
          ))}
          {[-0.78, 0.78].map((x) => (
            <mesh key={x} position={[x, 0, 0]}>
              <boxGeometry args={[0.07, 2.5, 0.42]} />
              <meshStandardMaterial color="#1a2433" metalness={0.95} roughness={0.28} emissive="#1d1150" emissiveIntensity={0.45} />
            </mesh>
          ))}
        </group>
        <mesh position={[barrierPos.x, 1.25, barrierPos.z]} quaternion={barrierQuat}>
          <boxGeometry args={[1.8, 0.06, 0.12]} />
          <meshStandardMaterial color="#121c29" metalness={0.9} roughness={0.3} emissive="#2a1a55" emissiveIntensity={0.8} />
        </mesh>
        <mesh position={[barrierPos.x, -1.25, barrierPos.z]} quaternion={barrierQuat}>
          <boxGeometry args={[1.8, 0.06, 0.12]} />
          <meshStandardMaterial color="#121c29" metalness={0.9} roughness={0.3} emissive="#2a1a55" emissiveIntensity={0.8} />
        </mesh>
        <lineSegments geometry={arcGeo} material={arcMat} />
        <points geometry={particleGeo} material={particleMat} frustumCulled={false} />
        <points ref={dustRef} geometry={dustGeo} material={dustMat} />
      </group>
    </>
  );
}

export default function AcceleratorRing(props: RingProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(true);
  const timer = useTimerDriven();
  useEffect(() => {
    if (!wrap.current) return;
    // Stop rendering while scrolled out of view (and while the tab is hidden).
    const io = new IntersectionObserver(([e]) => setActive(e.isIntersecting), { rootMargin: "100px" });
    io.observe(wrap.current);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={wrap} className={props.className} aria-hidden="true">
      <Canvas
        frameloop={active && !timer ? "always" : "never"}
        dpr={props.dpr ?? [1, 1.75]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ position: [0, 3.6, 11.8], fov: 40, near: 0.1, far: 80 }}
      >
        {timer && <TimerDriver active={active} />}
        <Scene {...props} />
      </Canvas>
    </div>
  );
}
