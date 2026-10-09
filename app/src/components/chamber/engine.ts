/**
 * Quantum tunnelling chamber renderer (Canvas 2D, additive blending).
 *
 * Each lane is a 1-D scattering problem off a rectangular barrier. The faint
 * wave drawn behind the particles is the real part of the stationary
 * solution, scaled from the lane's transmission probability T:
 *   x < a      ψ = e^{ikx} + r·e^{-ikx}     (incident + reflected, |r|² = 1 − T)
 *   a ≤ x ≤ b  ψ ∝ e^{-κ(x−a)}             (evanescent, e^{-2κd} = T)
 *   x > b      ψ = t·e^{ikx}               (transmitted, |t|² = T)
 *
 * Particles are drawn as Gaussian wave packets. In "live" mode their count and
 * fate come exclusively from the caller (onchain allocations and verified
 * outcomes); the engine never decides an outcome itself in that mode.
 */

export interface LaneSpec {
  transmissionBps: number;
  color: string;
  /** Barrier thickness relative to the chamber width (visual only). */
  thickness: number;
}

type ParticleState = "queued" | "incoming" | "inside" | "transmitted" | "reflected";

interface Particle {
  lane: number;
  x: number;
  y: number;
  vx: number;
  baseY: number;
  state: ParticleState;
  willTunnel: boolean;
  phase: number;
  alpha: number;
  born: number;
  trail: { x: number; y: number }[];
  queueSlot: number;
}

interface Ripple {
  lane: number;
  x: number;
  y: number;
  t: number;
  color: string;
  kind: "transmit" | "reflect";
}

export interface ChamberCounters {
  transmitted: number[];
  reflected: number[];
}

const GREEN = "#45E6B0";
const RED = "#FF7285";

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

/** Small deterministic PRNG for illustrative mode only. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ChamberEngine {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private raf = 0;
  private running = false;
  private last = 0;
  private time = 0;
  private particles: Particle[] = [];
  private ripples: Ripple[] = [];
  private sprites = new Map<string, HTMLCanvasElement>();
  private rand: () => number = Math.random;
  private spawnClock: number[] = [];
  private barrierFlash: number[] = [];
  private detectorFlash: { t: number[]; r: number[] } = { t: [], r: [] };
  private queuedTarget: number[] = [];
  private releaseQueue: { lane: number; tunnel: boolean; at: number }[] = [];
  counters: ChamberCounters = { transmitted: [0, 0, 0], reflected: [0, 0, 0] };
  onCounters?: (c: ChamberCounters) => void;

  constructor(
    private canvas: HTMLCanvasElement,
    private lanes: LaneSpec[],
    private mode: "illustrative" | "live",
    private opts: { reducedMotion?: boolean; density?: number; seed?: number; maxQueuedPerLane?: number } = {},
  ) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.rand = mulberry32(opts.seed ?? 0x5eed);
    this.resetLaneState();
  }

  private resetLaneState() {
    const n = this.lanes.length;
    this.spawnClock = Array(n).fill(0).map(() => this.rand() * 0.8);
    this.barrierFlash = Array(n).fill(0);
    this.detectorFlash = { t: Array(n).fill(0), r: Array(n).fill(0) };
    this.queuedTarget = Array(n).fill(0);
    this.counters = { transmitted: Array(n).fill(0), reflected: Array(n).fill(0) };
  }

  setLanes(lanes: LaneSpec[]) {
    const changed = lanes.length !== this.lanes.length;
    this.lanes = lanes;
    if (changed) {
      this.particles = [];
      this.resetLaneState();
    }
  }

  resize(width: number, height: number) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = width;
    this.h = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.warmed && width > 1 && height > 1) {
      this.warmed = true;
      if (this.mode === "illustrative") this.advance(this.opts.reducedMotion ? 7.3 : 4);
      else this.advance(2);
    }
    if (!this.running || this.opts.reducedMotion) this.frame(this.last || performance.now());
  }

  /**
   * Advances the simulation without drawing. Used so the chamber never opens
   * empty, and to compose a meaningful still frame for reduced-motion users.
   */
  private warmed = false;
  private advance(seconds: number) {
    const dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) {
      this.time += dt;
      this.step(dt);
    }
  }

  start() {
    if (this.running) return;
    if (this.opts.reducedMotion) {
      this.frame(performance.now()); // a single still frame; no animation loop
      return;
    }
    this.running = true;
    this.last = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.frame(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.stop();
    this.particles = [];
  }

  // ------------------------------------------------------------ live mode API

  /** Number of pending (unresolved) particles to show queued in each lane. */
  setQueued(counts: number[]) {
    const cap = this.opts.maxQueuedPerLane ?? 60;
    this.queuedTarget = counts.map((c) => Math.min(cap, c));
    if (this.opts.reducedMotion && this.warmed) {
      this.advance(2.5);
      this.frame(performance.now());
    }
  }

  /**
   * Plays a verified resolution: `outcomes[lane]` lists each particle's fate in
   * index order. Display is capped per lane; the caller shows exact totals.
   */
  playResolution(outcomes: boolean[][], durationMs = 3200) {
    const cap = this.opts.maxQueuedPerLane ?? 60;
    const now = this.time;
    this.counters = { transmitted: Array(this.lanes.length).fill(0), reflected: Array(this.lanes.length).fill(0) };
    const all: { lane: number; tunnel: boolean }[] = [];
    outcomes.forEach((list, lane) => {
      // Keep the displayed sample's success ratio faithful when capping.
      const shown = list.length <= cap ? list : sampleFaithfully(list, cap);
      shown.forEach((tunnel) => all.push({ lane, tunnel }));
    });
    const span = durationMs / 1000;
    all.forEach((a, i) => this.releaseQueue.push({ ...a, at: now + (all.length <= 1 ? 0 : (i / (all.length - 1)) * span) + this.rand() * 0.08 }));
    this.releaseQueue.sort((a, b) => a.at - b.at);
    this.queuedTarget = this.queuedTarget.map(() => 0);
    if (this.opts.reducedMotion) {
      // Jump to the moment just after the last particle meets its barrier.
      this.advance(span + 1.2);
      this.frame(performance.now());
    }
  }

  // ------------------------------------------------------------ geometry

  private laneY(i: number) {
    const n = this.lanes.length;
    const pad = Math.max(18, this.h * 0.08);
    const band = (this.h - pad * 2) / n;
    return pad + band * (i + 0.5);
  }

  private laneBand() {
    const n = this.lanes.length;
    const pad = Math.max(18, this.h * 0.08);
    return (this.h - pad * 2) / n;
  }

  private barrierX() {
    return this.w * 0.56;
  }

  private barrierWidth(i: number) {
    return Math.max(3, this.lanes[i].thickness * Math.min(this.w, 1200));
  }

  private kappa(i: number) {
    const T = Math.max(1e-4, this.lanes[i].transmissionBps / 10_000);
    return -Math.log(T) / (2 * this.barrierWidth(i));
  }

  // ------------------------------------------------------------ sprites

  private sprite(color: string, radius: number) {
    const key = `${color}:${radius}`;
    let s = this.sprites.get(key);
    if (s) return s;
    s = document.createElement("canvas");
    const size = Math.ceil(radius * 2 * this.dpr);
    s.width = s.height = size;
    const c = s.getContext("2d")!;
    const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, rgba("#FFFFFF", 0.95));
    g.addColorStop(0.12, rgba(color, 0.9));
    g.addColorStop(0.35, rgba(color, 0.28));
    g.addColorStop(1, rgba(color, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
    this.sprites.set(key, s);
    return s;
  }

  // ------------------------------------------------------------ simulation

  private spawn(lane: number, willTunnel: boolean, state: ParticleState = "incoming", queueSlot = -1) {
    const band = this.laneBand();
    const jitter = (this.rand() - 0.5) * band * 0.34;
    const p: Particle = {
      lane,
      x: state === "queued" ? this.queuePosition(lane, queueSlot).x : -10,
      y: this.laneY(lane) + jitter,
      baseY: this.laneY(lane) + jitter,
      vx: (0.16 + this.rand() * 0.05) * Math.max(320, this.w),
      state,
      willTunnel,
      phase: this.rand() * Math.PI * 2,
      alpha: 1,
      born: this.time,
      trail: [],
      queueSlot,
    };
    this.particles.push(p);
    return p;
  }

  private queuePosition(lane: number, slot: number) {
    const bx = this.barrierX();
    const cols = 12;
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    const band = this.laneBand();
    const spacing = Math.min(11, this.w * 0.012);
    return {
      x: bx - this.barrierWidth(lane) / 2 - 22 - col * spacing - (row % 2) * spacing * 0.5,
      y: this.laneY(lane) + ((row % 5) - 2) * Math.min(band * 0.14, 9),
    };
  }

  private step(dt: number) {
    const bx = this.barrierX();

    if (this.mode === "illustrative") {
      const density = this.opts.density ?? 1;
      this.lanes.forEach((l, i) => {
        this.spawnClock[i] -= dt;
        if (this.spawnClock[i] <= 0) {
          this.spawn(i, this.rand() < l.transmissionBps / 10_000);
          this.spawnClock[i] = (0.35 + this.rand() * 0.6) / density;
        }
      });
    }

    if (this.mode === "live") {
      // Maintain exactly the requested number of queued particles per lane.
      this.lanes.forEach((_, i) => {
        const queued = this.particles.filter((p) => p.lane === i && p.state === "queued");
        const target = this.queuedTarget[i] ?? 0;
        for (let k = queued.length; k < target; k++) {
          const p = this.spawn(i, false, "incoming", k);
          p.x = -10 - this.rand() * 80;
          p.state = "queued";
        }
        if (queued.length > target) queued.slice(target).forEach((p) => (p.alpha = -1));
      });
      // Release scheduled resolutions: reuse a queued particle if there is one.
      while (this.releaseQueue.length && this.releaseQueue[0].at <= this.time) {
        const r = this.releaseQueue.shift()!;
        const q = this.particles.find((p) => p.lane === r.lane && p.state === "queued");
        const p = q ?? this.spawn(r.lane, r.tunnel);
        p.state = "incoming";
        p.willTunnel = r.tunnel;
        p.vx = (0.2 + this.rand() * 0.05) * Math.max(320, this.w);
      }
    }

    for (const p of this.particles) {
      const bw = this.barrierWidth(p.lane);
      const a = bx - bw / 2;
      const b = bx + bw / 2;
      const ly = this.laneY(p.lane);
      switch (p.state) {
        case "queued": {
          const target = this.queuePosition(p.lane, p.queueSlot >= 0 ? p.queueSlot : 0);
          const jitterX = Math.sin(this.time * 1.7 + p.phase) * 1.6;
          const jitterY = Math.cos(this.time * 1.3 + p.phase * 1.7) * 1.6;
          p.x += (target.x + jitterX - p.x) * Math.min(1, dt * 2.2);
          p.y += (target.y + jitterY - p.y) * Math.min(1, dt * 2.2);
          break;
        }
        case "incoming":
          p.x += p.vx * dt;
          p.y += (p.baseY - p.y) * Math.min(1, dt * 3);
          if (p.x >= a) {
            if (p.willTunnel) {
              p.state = "inside";
            } else {
              p.state = "reflected";
              p.x = a;
              p.vx = -p.vx * 0.86;
              this.barrierFlash[p.lane] = 1;
              this.ripples.push({ lane: p.lane, x: a, y: p.y, t: 0, color: RED, kind: "reflect" });
            }
          }
          break;
        case "inside": {
          p.x += p.vx * dt * 0.42; // evanescent crossing reads as slower
          const depth = Math.max(0, p.x - a);
          p.alpha = Math.max(0.25, Math.exp(-this.kappa(p.lane) * depth * 0.9));
          if (p.x >= b) {
            p.state = "transmitted";
            p.alpha = 1;
            this.ripples.push({ lane: p.lane, x: b, y: p.y, t: 0, color: GREEN, kind: "transmit" });
          }
          break;
        }
        case "transmitted":
          p.x += p.vx * dt;
          p.y += (ly + (p.baseY - ly) * 0.6 - p.y) * Math.min(1, dt * 2);
          if (p.x > this.w - 14) {
            this.detectorFlash.t[p.lane] = 1;
            this.counters.transmitted[p.lane]++;
            p.alpha = -1;
            this.onCounters?.(this.counters);
          }
          break;
        case "reflected":
          p.x += p.vx * dt;
          p.alpha = Math.max(0, p.alpha - dt * 0.35);
          if (p.x < 14 || p.alpha <= 0.02) {
            this.detectorFlash.r[p.lane] = 1;
            this.counters.reflected[p.lane]++;
            p.alpha = -1;
            this.onCounters?.(this.counters);
          }
          break;
      }
      if (p.state !== "queued") {
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 14) p.trail.shift();
      }
    }
    this.particles = this.particles.filter((p) => p.alpha >= 0);
    for (const r of this.ripples) r.t += dt;
    this.ripples = this.ripples.filter((r) => r.t < 0.9);
    this.barrierFlash = this.barrierFlash.map((f) => Math.max(0, f - dt * 2.6));
    this.detectorFlash.t = this.detectorFlash.t.map((f) => Math.max(0, f - dt * 2.2));
    this.detectorFlash.r = this.detectorFlash.r.map((f) => Math.max(0, f - dt * 2.2));
  }

  // ------------------------------------------------------------ drawing

  private frame(t: number) {
    const dt = Math.min(0.05, (t - this.last) / 1000 || 0);
    this.last = t;
    if (!this.opts.reducedMotion) {
      this.time += dt;
      this.step(dt);
    }
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    this.drawAxes();
    this.lanes.forEach((_, i) => this.drawWave(i));
    this.lanes.forEach((_, i) => this.drawBarrier(i));
    this.drawDetectors();
    this.drawRipples();
    this.drawParticles();
  }

  private drawAxes() {
    const c = this.ctx;
    c.save();
    c.strokeStyle = "rgba(28,41,54,0.55)";
    c.lineWidth = 1;
    c.setLineDash([2, 6]);
    for (let i = 0; i < this.lanes.length; i++) {
      const y = Math.round(this.laneY(i)) + 0.5;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(this.w, y);
      c.stroke();
    }
    c.setLineDash([]);
    // fine tick marks along the bottom edge — instrument scale
    c.strokeStyle = "rgba(131,146,165,0.18)";
    const step = Math.max(24, this.w / 40);
    for (let x = step; x < this.w; x += step) {
      const big = Math.round(x / step) % 5 === 0;
      c.beginPath();
      c.moveTo(Math.round(x) + 0.5, this.h);
      c.lineTo(Math.round(x) + 0.5, this.h - (big ? 7 : 3));
      c.stroke();
    }
    c.restore();
  }

  private drawWave(i: number) {
    const c = this.ctx;
    const lane = this.lanes[i];
    const T = Math.max(1e-4, lane.transmissionBps / 10_000);
    const r = Math.sqrt(1 - T);
    const tAmp = Math.sqrt(T);
    const ly = this.laneY(i);
    const amp = this.laneBand() * 0.16;
    const bx = this.barrierX();
    const bw = this.barrierWidth(i);
    const a = bx - bw / 2;
    const b = bx + bw / 2;
    const k = (Math.PI * 2) / Math.max(52, this.w / 16);
    const omega = 2.2;
    const tt = this.time * omega;

    // ψ(x): incident + reflected standing wave, evanescent region, transmitted travelling wave.
    // Inside the barrier the amplitude is interpolated geometrically between the
    // boundary values so the curve stays continuous at both faces.
    const insideAmp = (x: number) => (1 - r) * Math.pow(tAmp / Math.max(1e-3, 1 - r), (x - a) / bw);
    const psi = (x: number) => {
      if (x < a) {
        const u = x - a;
        return Math.cos(k * u - tt) + r * Math.cos(-k * u - tt + Math.PI);
      }
      if (x <= b) return insideAmp(x) * Math.cos(-tt);
      return tAmp * Math.cos(k * (x - b) - tt);
    };
    // Time-averaged |ψ|², normalised by its maximum (1 + r)².
    const norm = (1 + r) ** 2;
    const density = (x: number) => {
      if (x < a) return (1 + r * r + 2 * r * Math.cos(2 * k * (x - a) + Math.PI)) / norm;
      if (x <= b) return insideAmp(x) ** 2 / norm;
      return T / norm;
    };

    c.save();
    // density fill
    const grad = c.createLinearGradient(0, ly - amp * 1.4, 0, ly);
    grad.addColorStop(0, rgba(lane.color, 0.16));
    grad.addColorStop(1, rgba(lane.color, 0));
    c.fillStyle = grad;
    c.beginPath();
    c.moveTo(0, ly);
    const stepPx = 3;
    for (let x = 0; x <= this.w; x += stepPx) {
      const d = density(x);
      c.lineTo(x, ly - Math.min(1.4, d * 1.1) * amp);
    }
    c.lineTo(this.w, ly);
    c.closePath();
    c.fill();

    // real part of ψ
    c.strokeStyle = rgba(lane.color, 0.42);
    c.lineWidth = 1.1;
    c.beginPath();
    for (let x = 0; x <= this.w; x += 2) {
      const left = x < 40 ? x / 40 : 1;
      const right = x > this.w - 40 ? (this.w - x) / 40 : 1;
      const y = ly - psi(x) * amp * 0.55 * Math.min(left, right);
      if (x === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
    c.restore();
  }

  private drawBarrier(i: number) {
    const c = this.ctx;
    const lane = this.lanes[i];
    const band = this.laneBand();
    const ly = this.laneY(i);
    const bw = this.barrierWidth(i);
    const bx = this.barrierX();
    const x0 = bx - bw / 2;
    const top = ly - band * 0.42;
    const hgt = band * 0.84;
    const flash = this.barrierFlash[i] ?? 0;

    c.save();
    // body
    const g = c.createLinearGradient(x0, 0, x0 + bw, 0);
    g.addColorStop(0, rgba(lane.color, 0.34 + flash * 0.3));
    g.addColorStop(0.5, rgba(lane.color, 0.16 + flash * 0.1));
    g.addColorStop(1, rgba(lane.color, 0.3));
    c.fillStyle = g;
    c.fillRect(x0, top, bw, hgt);

    // vertical fade at the caps
    const cap = c.createLinearGradient(0, top, 0, top + hgt);
    cap.addColorStop(0, "rgba(5,7,10,0.9)");
    cap.addColorStop(0.18, "rgba(5,7,10,0)");
    cap.addColorStop(0.82, "rgba(5,7,10,0)");
    cap.addColorStop(1, "rgba(5,7,10,0.9)");
    c.fillStyle = cap;
    c.fillRect(x0 - 1, top, bw + 2, hgt);

    // field lines: denser and brighter for higher barriers
    c.globalCompositeOperation = "lighter";
    const lines = Math.max(2, Math.round(bw / 3.2));
    c.lineWidth = 0.8;
    for (let k = 0; k < lines; k++) {
      const fx = x0 + ((k + 0.5) / lines) * bw;
      c.strokeStyle = rgba(lane.color, 0.16 + 0.1 * Math.sin(this.time * 1.4 + k));
      c.beginPath();
      for (let y = top + hgt * 0.12; y <= top + hgt * 0.88; y += 4) {
        const dx = Math.sin(y * 0.09 + this.time * 2.1 + k * 1.7) * Math.min(1.4, bw * 0.06);
        if (y === top + hgt * 0.12) c.moveTo(fx + dx, y);
        else c.lineTo(fx + dx, y);
      }
      c.stroke();
    }
    // faces
    for (const fx of [x0, x0 + bw]) {
      const fg = c.createLinearGradient(0, top, 0, top + hgt);
      fg.addColorStop(0, rgba(lane.color, 0));
      fg.addColorStop(0.5, rgba(lane.color, 0.85 + flash * 0.15));
      fg.addColorStop(1, rgba(lane.color, 0));
      c.strokeStyle = fg;
      c.lineWidth = fx === x0 ? 1.4 + flash * 1.6 : 1;
      c.beginPath();
      c.moveTo(Math.round(fx) + 0.5, top + hgt * 0.06);
      c.lineTo(Math.round(fx) + 0.5, top + hgt * 0.94);
      c.stroke();
    }
    // halo
    const halo = c.createRadialGradient(bx, ly, 0, bx, ly, band * 0.55);
    halo.addColorStop(0, rgba(lane.color, 0.08 + flash * 0.12));
    halo.addColorStop(1, rgba(lane.color, 0));
    c.fillStyle = halo;
    c.fillRect(bx - band * 0.6, ly - band * 0.6, band * 1.2, band * 1.2);
    c.restore();
  }

  private drawDetectors() {
    const c = this.ctx;
    c.save();
    c.globalCompositeOperation = "lighter";
    this.lanes.forEach((_, i) => {
      const ly = this.laneY(i);
      const half = this.laneBand() * 0.3;
      const ft = this.detectorFlash.t[i] ?? 0;
      const fr = this.detectorFlash.r[i] ?? 0;
      c.fillStyle = rgba(GREEN, 0.18 + ft * 0.7);
      c.fillRect(this.w - 4, ly - half, 2, half * 2);
      c.fillStyle = rgba(RED, 0.12 + fr * 0.6);
      c.fillRect(2, ly - half, 2, half * 2);
    });
    c.restore();
  }

  private drawRipples() {
    const c = this.ctx;
    c.save();
    c.globalCompositeOperation = "lighter";
    for (const r of this.ripples) {
      const k = r.t / 0.9;
      const rad = 4 + k * (r.kind === "transmit" ? 34 : 22);
      c.strokeStyle = rgba(r.color, (1 - k) * 0.6);
      c.lineWidth = 1.2;
      c.beginPath();
      if (r.kind === "transmit") c.ellipse(r.x, r.y, rad, rad * 0.62, 0, -Math.PI / 2, Math.PI / 2);
      else c.ellipse(r.x, r.y, rad * 0.5, rad, 0, Math.PI / 2, (Math.PI * 3) / 2);
      c.stroke();
    }
    c.restore();
  }

  private drawParticles() {
    const c = this.ctx;
    c.save();
    c.globalCompositeOperation = "lighter";
    const scale = Math.max(0.75, Math.min(1.25, this.w / 1000));
    for (const p of this.particles) {
      const lane = this.lanes[p.lane];
      const color = p.state === "transmitted" ? mix(lane.color, GREEN, 0.35) : p.state === "reflected" ? mix(lane.color, RED, 0.45) : lane.color;
      const a = Math.max(0, Math.min(1, p.alpha));

      // trail
      if (p.trail.length > 2) {
        c.lineCap = "round";
        for (let k = 1; k < p.trail.length; k++) {
          const t0 = p.trail[k - 1];
          const t1 = p.trail[k];
          c.strokeStyle = rgba(color, (k / p.trail.length) * 0.35 * a);
          c.lineWidth = (k / p.trail.length) * 2.2 * scale;
          c.beginPath();
          c.moveTo(t0.x, t0.y);
          c.lineTo(t1.x, t1.y);
          c.stroke();
        }
      }

      // wave packet: Gaussian-enveloped carrier around the particle
      if (p.state !== "queued") {
        const span = 26 * scale;
        c.strokeStyle = rgba(color, 0.5 * a);
        c.lineWidth = 0.9;
        c.beginPath();
        for (let dx = -span; dx <= span; dx += 1.5) {
          const env = Math.exp(-(dx * dx) / (2 * (span / 2.6) ** 2));
          const y = p.y + Math.sin(dx * 0.55 - this.time * 14 * Math.sign(p.vx) + p.phase) * 5 * scale * env;
          if (dx === -span) c.moveTo(p.x + dx, y);
          else c.lineTo(p.x + dx, y);
        }
        c.stroke();
      }

      const radius = (p.state === "queued" ? 7 : 11) * scale;
      const s = this.sprite(color, Math.round(radius));
      c.globalAlpha = a * (p.state === "queued" ? 0.75 + 0.25 * Math.sin(this.time * 3 + p.phase) : 1);
      c.drawImage(s, p.x - radius, p.y - radius, radius * 2, radius * 2);
      c.globalAlpha = 1;
    }
    c.restore();
  }
}

function mix(a: string, b: string, t: number) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const h = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${h(r1 + (r2 - r1) * t)}${h(g1 + (g2 - g1) * t)}${h(b1 + (b2 - b1) * t)}`;
}

/** Picks `n` outcomes whose success count is proportional to the full list's. */
function sampleFaithfully(list: boolean[], n: number) {
  const successes = list.filter(Boolean).length;
  const s = Math.round((successes / list.length) * n);
  const out = [...Array(s).fill(true), ...Array(n - s).fill(false)];
  for (let i = out.length - 1; i > 0; i--) {
    const j = (i * 7919) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
