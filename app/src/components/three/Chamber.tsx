"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { psiAt, solveBarrier } from "@tunnel/sdk";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import * as THREE from "three";
import { TimerDriver, useTimerDriven } from "./driver";
import { energyRing, glowPoints, plasmaBarrier, shockwave, softLight } from "./shaders";

/**
 * The linear acceleration chamber of the Accelerator page.
 *
 * Geometry along −z: particle source (z = 6) → acceleration tube → potential
 * barrier (z = −14, thickness proportional to its width a) → transmission
 * zone → detector ring (z = −24).
 *
 * The parent drives it imperatively. `play()` runs one cinematic for a
 * *settled* particle outcome (never a guess): charging → acceleration →
 * outcome. The wave drawn along the tube is the exact stationary-state
 * wavefunction for that experiment's E, V₀ and a.
 */
export type ChamberPhase = "idle" | "charging" | "accelerating" | "tunneled" | "reflected" | "done";

export interface ChamberApi {
  play: (p: { tunnel: boolean; color: string; e: number; v0: number; a: number; fast?: boolean }) => Promise<void>;
  /** Particles waiting in the storage orbit for the cycle to settle. */
  setQueued: (n: number, colors?: string[]) => void;
  /** Brief injection animation when a deployment is confirmed. */
  inject: (color: string, count: number) => void;
}

interface Props {
  apiRef: Ref<ChamberApi>;
  onPhase?: (p: ChamberPhase) => void;
  dpr?: [number, number];
  reducedMotion?: boolean;
  particles?: number;
  barrierColor?: string;
  className?: string;
}

const SOURCE_Z = 6;
const BARRIER_Z = -14;
const DETECTOR_Z = -24;
const TUBE_R = 1.55;
const DUR = { charge: 1.6, accel: 2.2, outcome: 2.4 };

const col = (c: string) => new THREE.Color(c);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function makeGlow(pr: number, scale: number) {
  return new THREE.ShaderMaterial({
    vertexShader: glowPoints.vertex,
    fragmentShader: glowPoints.fragment,
    uniforms: { uPixelRatio: { value: pr }, uScale: { value: scale } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

interface Shot {
  kind: "lead";
  tunnel: boolean;
  color: THREE.Color;
  t0: number;
  wave: ReturnType<typeof solveBarrier>;
  fast: boolean;
  resolve: () => void;
  phase: ChamberPhase;
}

function Scene({ apiRef, onPhase, reducedMotion, particles = 120, barrierColor = "#885BFF" }: Props) {
  const { gl, camera, size } = useThree();
  const pr = gl.getPixelRatio();
  const clock = useRef(0);
  const shot = useRef<Shot | null>(null);
  const queued = useRef<{ n: number; colors: THREE.Color[] }>({ n: 0, colors: [] });
  const injections = useRef<{ t0: number; color: THREE.Color; count: number }[]>([]);
  const streams = useRef<{ t0: number; tunnel: boolean; color: THREE.Color; lane: number }[]>([]);
  const shock = useRef(-10);
  const charge = useRef(0);

  // ---------------------------------------------------------------- materials
  const arches = useMemo(() => {
    const list: { z: number; mat: THREE.ShaderMaterial }[] = [];
    for (let z = SOURCE_Z - 1.2; z > DETECTOR_Z + 1; z -= 1.6) {
      if (Math.abs(z - BARRIER_Z) < 1.2) continue;
      list.push({
        z,
        mat: new THREE.ShaderMaterial({
          vertexShader: energyRing.vertex,
          fragmentShader: energyRing.fragment,
          uniforms: { uTime: { value: 0 }, uColor: { value: col("#2864FF") }, uHot: { value: col("#00D9FF") }, uIntensity: { value: 0.8 }, uSpeed: { value: 0.05 }, uPulses: { value: 3 } },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      });
    }
    return list;
  }, []);
  const archGeo = useMemo(() => new THREE.TorusGeometry(TUBE_R, 0.022, 8, 96), []);
  const frameMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#0f1824", metalness: 0.9, roughness: 0.35, emissive: "#050b16", emissiveIntensity: 0.5 }), []);

  const barrierMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: plasmaBarrier.vertex,
        fragmentShader: plasmaBarrier.fragment,
        uniforms: {
          uTime: { value: 0 },
          uColorA: { value: col(barrierColor) },
          uColorB: { value: col("#2864FF") },
          uFlare: { value: col("#EAFBFF") },
          uImpact: { value: new THREE.Vector3(0.5, 0.5, -10) },
          uBreach: { value: 0 },
          uIntensity: { value: 0.9 },
          uDistort: { value: 1.5 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    barrierMat.uniforms.uColorA.value = col(barrierColor);
  }, [barrierColor, barrierMat]);

  const shockMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: shockwave.vertex,
        fragmentShader: shockwave.fragment,
        uniforms: { uProgress: { value: 1 }, uColor: { value: col("#EAFBFF") } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const sourceGlowMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: softLight.vertex,
        fragmentShader: softLight.fragment,
        uniforms: { uColor: { value: col("#00D9FF") }, uIntensity: { value: 0.3 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const detectorMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#1d3350", transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }), []);
  const pointsMat = useMemo(() => makeGlow(pr, 360), [pr]);
  const waveMat = useMemo(() => new THREE.LineBasicMaterial({ color: "#00D9FF", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), []);

  // ---------------------------------------------------------------- dynamic geometry
  const N = particles;
  const pts = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage));
    return g;
  }, [N]);
  const WAVE_N = 360;
  const waveGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(WAVE_N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    return g;
  }, []);
  const dust = useMemo(() => {
    const n = Math.round(N * 1.5);
    const pos = new Float32Array(n * 3);
    const c = new Float32Array(n * 3);
    const s = new Float32Array(n);
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = TUBE_R * (0.3 + Math.random() * 1.6);
      const th = Math.random() * Math.PI * 2;
      pos.set([Math.cos(th) * r, Math.sin(th) * r, SOURCE_Z - Math.random() * 34], i * 3);
      const k = [col("#00D9FF"), col("#2864FF"), col("#885BFF")][i % 3];
      c.set([k.r, k.g, k.b], i * 3);
      s[i] = 0.4 + Math.random() * 0.8;
      a[i] = 0.08 + Math.random() * 0.18;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(c, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(s, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(a, 1));
    return g;
  }, [N]);
  const dustMat = useMemo(() => makeGlow(pr, 120), [pr]);
  const waveLine = useMemo(() => {
    const l = new THREE.Line(waveGeo, waveMat);
    l.frustumCulled = false;
    return l;
  }, [waveGeo, waveMat]);

  useEffect(
    () => () => {
      arches.forEach((a) => a.mat.dispose());
      [archGeo, pts, waveGeo, dust].forEach((g) => g.dispose());
      [frameMat, barrierMat, shockMat, sourceGlowMat, detectorMat, pointsMat, waveMat, dustMat].forEach((m) => m.dispose());
    },
    [arches, archGeo, pts, waveGeo, dust, frameMat, barrierMat, shockMat, sourceGlowMat, detectorMat, pointsMat, waveMat, dustMat],
  );

  // ---------------------------------------------------------------- API
  const emit = (p: ChamberPhase) => {
    if (shot.current) shot.current.phase = p;
    onPhase?.(p);
  };

  useImperativeHandle(apiRef, () => ({
    play: ({ tunnel, color, e, v0, a, fast }) =>
      new Promise<void>((resolve) => {
        if (fast) {
          streams.current.push({ t0: clock.current, tunnel, color: col(color), lane: Math.random() });
          setTimeout(resolve, 120);
          return;
        }
        shot.current?.resolve();
        shot.current = { kind: "lead", tunnel, color: col(color), t0: clock.current, wave: solveBarrier(e, v0, a), fast: false, resolve, phase: "charging" };
        onPhase?.("charging");
      }),
    setQueued: (n, colors) => {
      queued.current = { n, colors: (colors ?? []).map(col) };
    },
    inject: (color, count) => injections.current.push({ t0: clock.current, color: col(color), count: Math.min(count, 24) }),
  }));

  const camPos = useMemo(() => new THREE.Vector3(7.5, 4.6, 11), []);
  const camLook = useMemo(() => new THREE.Vector3(0, 0, -6), []);
  const curLook = useRef(new THREE.Vector3(0, 0, -6));
  const coilRefs = useRef<(THREE.Mesh | null)[]>([]);
  const sourceRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const shockRef = useRef<THREE.Mesh>(null);
  const narrow = size.width < 700;

  useFrame((_, raw) => {
    const dt = reducedMotion ? 0 : Math.min(raw, 1 / 30);
    clock.current += reducedMotion ? 1 / 60 : dt;
    const t = clock.current;
    arches.forEach((a) => (a.mat.uniforms.uTime.value = t));
    barrierMat.uniforms.uTime.value = t;

    const pos = pts.attributes.position.array as Float32Array;
    const cc = pts.attributes.aColor.array as Float32Array;
    const sz = pts.attributes.aSize.array as Float32Array;
    const al = pts.attributes.aAlpha.array as Float32Array;
    al.fill(0);
    let k = 0;
    const put = (x: number, y: number, z: number, c: THREE.Color, s: number, a: number) => {
      if (k >= N) return;
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      cc[k * 3] = c.r;
      cc[k * 3 + 1] = c.g;
      cc[k * 3 + 2] = c.b;
      sz[k] = s;
      al[k] = a;
      k++;
    };

    // ---- queued particles orbiting the source (storage ring)
    const q = queued.current;
    for (let i = 0; i < Math.min(q.n, 40); i++) {
      const th = t * 1.4 + (i / Math.max(1, Math.min(q.n, 40))) * Math.PI * 2;
      put(Math.cos(th) * 0.95, Math.sin(th) * 0.95, SOURCE_Z + 0.2 + Math.sin(th * 3) * 0.05, q.colors[i % Math.max(1, q.colors.length)] ?? col("#00D9FF"), 1.4, 0.9);
    }

    // ---- injection bursts: particles spiral into the storage ring
    injections.current = injections.current.filter((inj) => t - inj.t0 < 1.4);
    for (const inj of injections.current) {
      const p = (t - inj.t0) / 1.4;
      for (let i = 0; i < inj.count; i++) {
        const th = i * 2.4 + p * 7;
        const r = 3.4 * (1 - ease(p)) + 0.95;
        put(Math.cos(th) * r, Math.sin(th) * r, SOURCE_Z + 3 * (1 - p), inj.color, 1.6, 1 - p * 0.4);
      }
    }

    // ---- ambient flow (decorative, labelled in the UI): dim particles drift down the
    // tube and fade out before the barrier, so they never imply an outcome.
    if (!shot.current && !reducedMotion) {
      for (let i = 0; i < 10; i++) {
        const p = (t * 0.06 + i / 10) % 1;
        const z = SOURCE_Z - 1 - p * (SOURCE_Z - BARRIER_Z - 3);
        const th = i * 2.1;
        put(Math.cos(th) * 0.5, Math.sin(th) * 0.5, z, col(["#00D9FF", "#2864FF", "#885BFF"][i % 3]), 1.2, 0.45 * Math.sin(p * Math.PI));
      }
    }

    // ---- fast streams (remaining particles of an experiment)
    streams.current = streams.current.filter((s) => t - s.t0 < 1.6);
    for (const s of streams.current) {
      const p = (t - s.t0) / 1.6;
      const y = (s.lane - 0.5) * 1.2;
      const x = Math.sin(s.lane * 20) * 0.6;
      let z = SOURCE_Z - p * (SOURCE_Z - BARRIER_Z) * 1.6;
      let c = s.color;
      let a = 1;
      if (z < BARRIER_Z) {
        if (s.tunnel) c = col("#EAFBFF");
        else {
          z = BARRIER_Z + (BARRIER_Z - z) * 0.7;
          c = col("#F0A64B");
          a = Math.max(0, 1 - (p - 0.62) * 3);
        }
      }
      put(x, y, z, c, 1.7, a);
      for (let j = 1; j < 5; j++) put(x, y, z + j * 0.35 * (z < BARRIER_Z && !s.tunnel ? -1 : 1), c, 1.3 - j * 0.2, a * (0.5 - j * 0.09));
      if (Math.abs(z - BARRIER_Z) < 0.4 && !s.tunnel) barrierMat.uniforms.uImpact.value.set(0.5 + x / 5, 0.5 + y / 4, t);
    }

    // ---- lead shot timeline
    const sh = shot.current;
    let target = SOURCE_Z;
    charge.current = Math.max(0, charge.current - dt * 0.8);
    if (sh) {
      const el = t - sh.t0;
      const tC = DUR.charge;
      const tA = tC + DUR.accel;
      const tO = tA + DUR.outcome;
      if (el < tC) {
        charge.current = Math.min(1, el / tC);
        put(0, 0, SOURCE_Z, sh.color, 1.5 + charge.current * 3, 0.6 + charge.current * 0.4);
        // energy gathering into the source
        for (let j = 0; j < 14; j++) {
          const th = j * 0.45 + el * 6;
          const r = 1.4 * (1 - charge.current) + 0.15;
          put(Math.cos(th) * r, Math.sin(th) * r, SOURCE_Z + Math.sin(j) * 0.2, col("#00D9FF"), 1.1, 0.35 + charge.current * 0.5);
        }
        target = SOURCE_Z;
      } else if (el < tA) {
        if (sh.phase !== "accelerating") emit("accelerating");
        const p = ease((el - tC) / DUR.accel);
        const z = SOURCE_Z - p * (SOURCE_Z - (BARRIER_Z + 0.6));
        target = z;
        put(0, 0, z, sh.color, 3.4, 1);
        for (let j = 1; j < 14; j++) put(0, 0, z + j * 0.28 * (0.4 + p), sh.color, 3 - j * 0.18, 0.7 * (1 - j / 14));
      } else if (el < tO) {
        const p = (el - tA) / DUR.outcome;
        if (sh.phase === "accelerating") {
          emit(sh.tunnel ? "tunneled" : "reflected");
          barrierMat.uniforms.uImpact.value.set(0.5, 0.5, t);
          if (sh.tunnel) shock.current = t + 0.5;
        }
        if (sh.tunnel) {
          barrierMat.uniforms.uBreach.value = Math.max(0, 1 - p * 1.2);
          const z = BARRIER_Z + 0.6 - ease(p) * (BARRIER_Z + 0.6 - DETECTOR_Z);
          target = z;
          const white = col("#EAFBFF");
          put(0, 0, z, white, 4, 1);
          for (let j = 1; j < 14; j++) put(0, 0, z + j * 0.3, white, 3.4 - j * 0.2, 0.6 * (1 - j / 14));
        } else {
          const z = BARRIER_Z + 0.6 + ease(Math.min(1, p * 1.4)) * 7;
          target = BARRIER_Z + 3;
          const amber = col("#F0A64B");
          const fade = Math.max(0, 1 - p * 1.1);
          put(0, 0, z, amber, 3.2, fade);
          for (let j = 1; j < 10; j++) put(0, 0, z - j * 0.25, amber, 2.6 - j * 0.2, 0.5 * fade * (1 - j / 10));
        }
      } else {
        emit("done");
        shot.current = null;
        sh.resolve();
      }

      // the wave: exact ψ for this experiment, drawn along the beam axis
      const show = el > tC * 0.6;
      waveMat.opacity += ((show ? 0.85 : 0) - waveMat.opacity) * 0.08;
      const s = sh.wave;
      const zScale = 1.0 / Math.max(0.35, s.a); // barrier width maps to ~1 unit of tube
      const wp = waveGeo.attributes.position.array as Float32Array;
      const lam = (2 * Math.PI) / s.k;
      const span = Math.max(6 * lam, 8);
      for (let i = 0; i < WAVE_N; i++) {
        const x = -span + ((span * 2 + s.a) * i) / (WAVE_N - 1);
        const z = BARRIER_Z + 0.5 - x * zScale;
        const ps = psiAt(s, x, t * 3);
        wp[i * 3] = 0;
        wp[i * 3 + 1] = -0.9 + ps.re * 0.32;
        wp[i * 3 + 2] = z;
      }
      waveGeo.attributes.position.needsUpdate = true;
      waveMat.color.set(sh.tunnel ? "#00D9FF" : "#2864FF");
    } else {
      waveMat.opacity *= 0.95;
    }

    // ---- shockwave at the detector
    const sp = (t - shock.current) / 1.6;
    shockMat.uniforms.uProgress.value = sp >= 0 && sp <= 1 ? sp : 1;
    detectorMat.color.set(sp >= 0 && sp < 1 ? "#9fe9ff" : "#1d3350");
    if (shockRef.current) shockRef.current.scale.setScalar(1 + Math.max(0, Math.min(1, sp)) * 2.5);

    // ---- source charging
    coilRefs.current.forEach((m, i) => m && (m.rotation.z += dt * (0.6 + charge.current * 9) * (i % 2 ? -1 : 1)));
    sourceGlowMat.uniforms.uIntensity.value = 0.25 + charge.current * 0.6;
    if (sourceRef.current) sourceRef.current.scale.setScalar(1 + charge.current * 0.6 + Math.sin(t * 30) * 0.03 * charge.current);
    if (glowRef.current) glowRef.current.quaternion.copy(camera.quaternion);

    // arches light up as the lead particle passes
    arches.forEach((a) => {
      const d = Math.abs(a.z - target);
      a.mat.uniforms.uIntensity.value = 0.7 + (sh && target !== SOURCE_Z ? Math.exp(-d * 0.9) * 1.6 : 0);
    });

    pts.attributes.position.needsUpdate = true;
    pts.attributes.aColor.needsUpdate = true;
    pts.attributes.aSize.needsUpdate = true;
    pts.attributes.aAlpha.needsUpdate = true;

    // ---- camera
    if (sh && t - sh.t0 > 0.2) {
      const el = t - sh.t0;
      if (el < DUR.charge) {
        camPos.set(3.2, 1.5, SOURCE_Z + 5.4);
        camLook.set(0, 0, SOURCE_Z - 2);
      } else {
        camPos.set(narrow ? 0.9 : 0.7, 0.55, target + 4.6);
        camLook.set(0, 0, target - 7);
      }
    } else {
      if (narrow) camPos.set(7, 5.5, 9);
      else camPos.set(8.5, 4.2, 4.5);
      camLook.set(0, -0.6, -9);
    }
    const lerp = reducedMotion ? 1 : sh ? 0.07 : 0.03;
    camera.position.lerp(camPos, lerp);
    curLook.current.lerp(camLook, lerp);
    camera.lookAt(curLook.current);
  });

  return (
    <>
      <fog attach="fog" args={["#05070B", 14, 46]} />
      <ambientLight intensity={0.14} />
      <directionalLight position={[6, 10, 4]} intensity={0.8} color="#9fdcff" />
      <pointLight position={[0, 0, SOURCE_Z]} intensity={4} distance={8} color="#00D9FF" />
      <pointLight position={[0, 2, BARRIER_Z + 1]} intensity={6} distance={9} color={barrierColor} />

      {/* floor grid */}
      <gridHelper args={[60, 60, "#152234", "#0d1621"]} position={[0, -TUBE_R - 0.9, -8]} />

      {/* acceleration tube */}
      {arches.map((a, i) => (
        <group key={i} position={[0, 0, a.z]}>
          <mesh geometry={archGeo} material={a.mat} />
        </group>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (TUBE_R + 0.2), -TUBE_R + 0.1, -9]} material={frameMat}>
          <boxGeometry args={[0.06, 0.06, 32]} />
        </mesh>
      ))}

      {/* particle source */}
      <group position={[0, 0, SOURCE_Z]}>
        <mesh ref={sourceRef}>
          <sphereGeometry args={[0.07, 24, 12]} />
          <meshBasicMaterial color="#EAFBFF" />
        </mesh>
        {[0.55, 0.75, 0.95].map((r, i) => (
          <mesh key={r} ref={(m) => void (coilRefs.current[i] = m)} rotation={[0, i * 0.5, 0]}>
            <torusGeometry args={[r, 0.012, 6, 64, Math.PI * 1.6]} />
            <meshBasicMaterial color={i === 1 ? "#2864FF" : "#00D9FF"} transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        ))}
        <mesh ref={glowRef} material={sourceGlowMat}>
          <planeGeometry args={[5, 5]} />
        </mesh>
      </group>

      {/* potential barrier: two faces of a volume plus emitter frame */}
      <group position={[0, 0, BARRIER_Z]}>
        {[0.5, -0.5].map((z) => (
          <mesh key={z} position={[0, 0, z]} material={barrierMat}>
            <planeGeometry args={[4.6, 3.8, 1, 1]} />
          </mesh>
        ))}
        {[-2.45, 2.45].map((x) => (
          <mesh key={x} position={[x, 0, 0]}>
            <boxGeometry args={[0.16, 4.2, 1.3]} />
            <meshStandardMaterial color="#141d2a" metalness={0.95} roughness={0.28} emissive="#1d1150" emissiveIntensity={0.5} />
          </mesh>
        ))}
        {[-2.05, 2.05].map((y) => (
          <mesh key={y} position={[0, y, 0]}>
            <boxGeometry args={[5.06, 0.12, 1.3]} />
            <meshStandardMaterial color="#141d2a" metalness={0.95} roughness={0.28} emissive="#1d1150" emissiveIntensity={0.5} />
          </mesh>
        ))}
      </group>

      {/* detector + shockwave */}
      <mesh position={[0, 0, DETECTOR_Z]} material={detectorMat}>
        <torusGeometry args={[2.2, 0.05, 8, 96]} />
      </mesh>
      <mesh ref={shockRef} position={[0, 0, DETECTOR_Z + 0.1]} material={shockMat}>
        <planeGeometry args={[3, 3]} />
      </mesh>

      <primitive object={waveLine} />
      <points geometry={pts} material={pointsMat} frustumCulled={false} />
      <points geometry={dust} material={dustMat} />
    </>
  );
}

export default function Chamber(props: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(true);
  const timer = useTimerDriven();
  useEffect(() => {
    if (!wrap.current) return;
    const io = new IntersectionObserver(([e]) => setActive(e.isIntersecting), { rootMargin: "100px" });
    io.observe(wrap.current);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={wrap} className={props.className} aria-hidden="true">
      <Canvas frameloop={active && !timer ? "always" : "never"} dpr={props.dpr ?? [1, 1.75]} gl={{ antialias: true, alpha: true }} camera={{ position: [8.5, 4.2, 4.5], fov: 42, near: 0.1, far: 120 }}>
        {timer && <TimerDriver active={active} />}
        <Scene {...props} />
      </Canvas>
    </div>
  );
}
