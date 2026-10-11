/**
 * Quantum tunneling through a one-dimensional rectangular potential barrier
 * V(x) = V₀ for 0 ≤ x ≤ a, 0 elsewhere.
 *
 * Units: normalized so that ħ²/2m = 1, giving k = √E outside the barrier and
 * κ = √(V₀ − E) inside. For an electron with a length unit of 1 Å the energy
 * unit is ħ²/(2mₑ·Å²) ≈ 3.81 eV (see `ELECTRON_ENERGY_UNIT_EV`).
 *
 * Two independent solutions are provided:
 *  - `transmission`: the closed form T = [1 + V₀² sinh²(κa) / 4E(V₀−E)]⁻¹,
 *    evaluated in the stable sinh(x)/x form. Exact mirror of
 *    programs/tunnel/src/physics.rs, which derives the onchain odds.
 *  - `solveBarrier`: the full wavefunction from matching ψ and ψ' at both
 *    barrier edges (complex amplitudes r, C, D, t). |t|² reproduces T, which
 *    the test suite checks across the parameter space.
 */

/** ħ²/(2mₑ) in eV·Å² — the energy unit when lengths are measured in Å. */
export const ELECTRON_ENERGY_UNIT_EV = 3.80998208;

function sinhc(x: number) {
  return x < 1e-4 ? 1 + (x * x) / 6 : Math.sinh(x) / x;
}

function sinc(x: number) {
  return x < 1e-4 ? 1 - (x * x) / 6 : Math.sin(x) / x;
}

/** Transmission probability T(E, V₀, a). 0 for E ≤ 0 or invalid inputs. Valid for E above the barrier too. */
export function transmission(e: number, v0: number, a: number): number {
  if (!(e > 0) || !(v0 > 0) || !(a > 0)) return 0;
  const d = v0 - e;
  const f = d > 0 ? sinhc(a * Math.sqrt(d)) : d < 0 ? sinc(a * Math.sqrt(-d)) : 1;
  const s = (v0 * v0 * a * a * f * f) / (4 * e);
  return 1 / (1 + s);
}

export const PPB = 1_000_000_000;
export const MIN_TRANSMISSION_PPB = 100_000;
export const MAX_TRANSMISSION_PPB = 990_000_000;

/**
 * Fixed-point mirror of the program: V₀ = heightMilli/1000, a = widthMilli/1000,
 * E = V₀ · energyBps/10⁴. Rounded half-up to parts per billion; null outside the protocol bounds.
 */
export function transmissionPpb(heightMilli: number, widthMilli: number, energyBps: number): number | null {
  const v0 = heightMilli / 1000;
  const a = widthMilli / 1000;
  const e = (v0 * energyBps) / 10_000;
  const ppb = Math.floor(transmission(e, v0, a) * PPB + 0.5);
  return ppb >= MIN_TRANSMISSION_PPB && ppb <= MAX_TRANSMISSION_PPB ? ppb : null;
}

// ---------------------------------------------------------------- wavefunction

export class Complex {
  constructor(readonly re: number, readonly im = 0) {}
  static polar(r: number, theta: number) {
    return new Complex(r * Math.cos(theta), r * Math.sin(theta));
  }
  add(o: Complex) {
    return new Complex(this.re + o.re, this.im + o.im);
  }
  sub(o: Complex) {
    return new Complex(this.re - o.re, this.im - o.im);
  }
  mul(o: Complex) {
    return new Complex(this.re * o.re - this.im * o.im, this.re * o.im + this.im * o.re);
  }
  div(o: Complex) {
    const d = o.re * o.re + o.im * o.im;
    return new Complex((this.re * o.re + this.im * o.im) / d, (this.im * o.re - this.re * o.im) / d);
  }
  scale(s: number) {
    return new Complex(this.re * s, this.im * s);
  }
  abs2() {
    return this.re * this.re + this.im * this.im;
  }
  /** e^this */
  exp() {
    return Complex.polar(Math.exp(this.re), this.im);
  }
}

const I = new Complex(0, 1);

export interface BarrierSolution {
  e: number;
  v0: number;
  a: number;
  /** Wave number outside the barrier, k = √E. */
  k: number;
  /** Inside the barrier ψ = C e^{qx} + D e^{−qx}; q = κ (real) below the barrier, i·√(E−V₀) above it. */
  q: Complex;
  r: Complex;
  t: Complex;
  C: Complex;
  D: Complex;
  /** Reflection |r|² and transmission |t|² probabilities. */
  R: number;
  T: number;
}

/**
 * Solves the stationary scattering problem for a unit-amplitude wave incident
 * from the left: ψ = e^{ikx} + r e^{−ikx} (x < 0), C e^{qx} + D e^{−qx}
 * (0 ≤ x ≤ a), t e^{ikx} (x > a), with ψ and ψ' continuous at 0 and a.
 */
export function solveBarrier(e: number, v0: number, a: number): BarrierSolution {
  if (!(e > 0) || !(v0 > 0) || !(a > 0)) throw new Error("E, V0 and a must be positive");
  // q = 0 (E = V0 exactly) is a removable singularity of this parametrisation.
  if (Math.abs(e - v0) < 1e-12 * v0) e = v0 * (1 + 1e-9);
  const k = Math.sqrt(e);
  const d = v0 - e;
  const q = d > 0 ? new Complex(Math.sqrt(d)) : new Complex(0, Math.sqrt(-d));
  const ik = new Complex(0, k);
  const u = q.div(ik).add(ik.div(q)); // q/(ik) + ik/q
  const eqa = q.scale(a).exp();
  const emqa = q.scale(-a).exp();
  const two = new Complex(2);
  const denom = emqa.mul(two.add(u)).add(eqa.mul(two.sub(u)));
  const eika = ik.scale(a).exp();
  const emika = ik.scale(-a).exp();
  const t = new Complex(4).mul(emika).div(denom);
  const ikq = ik.div(q);
  const half = t.mul(eika).scale(0.5);
  const C = half.mul(emqa).mul(new Complex(1).add(ikq));
  const D = half.mul(eqa).mul(new Complex(1).sub(ikq));
  const r = C.add(D).sub(new Complex(1));
  return { e, v0, a, k, q, r, t, C, D, R: r.abs2(), T: t.abs2() };
}

/** ψ(x) for a solved barrier at time phase ωt (the stationary state rotates as e^{−iωt}). */
export function psiAt(s: BarrierSolution, x: number, phase = 0): Complex {
  const ik = new Complex(0, s.k);
  let psi: Complex;
  if (x < 0) {
    psi = ik.scale(x).exp().add(s.r.mul(ik.scale(-x).exp()));
  } else if (x <= s.a) {
    psi = s.C.mul(s.q.scale(x).exp()).add(s.D.mul(s.q.scale(-x).exp()));
  } else {
    psi = s.t.mul(ik.scale(x).exp());
  }
  return phase ? psi.mul(Complex.polar(1, -phase)) : psi;
}

/** Incident, reflected and transmitted components on the outside regions (for diagrams). */
export function waveComponents(s: BarrierSolution, x: number, phase = 0) {
  const ik = new Complex(0, s.k);
  const rot = Complex.polar(1, -phase);
  return {
    incident: x < 0 ? ik.scale(x).exp().mul(rot) : null,
    reflected: x < 0 ? s.r.mul(ik.scale(-x).exp()).mul(rot) : null,
    transmitted: x > s.a ? s.t.mul(ik.scale(x).exp()).mul(rot) : null,
  };
}

/** Samples Re ψ, Im ψ and |ψ|² over [xMin, xMax]. */
export function sampleWavefunction(s: BarrierSolution, xMin: number, xMax: number, n: number, phase = 0) {
  const out: { x: number; re: number; im: number; prob: number }[] = [];
  for (let i = 0; i < n; i++) {
    const x = xMin + ((xMax - xMin) * i) / (n - 1);
    const p = psiAt(s, x, phase);
    out.push({ x, re: p.re, im: p.im, prob: p.abs2() });
  }
  return out;
}

/** Converts normalized energy units to eV for an electron (length unit 1 Å). */
export const toElectronVolts = (normalizedEnergy: number) => normalizedEnergy * ELECTRON_ENERGY_UNIT_EV;
