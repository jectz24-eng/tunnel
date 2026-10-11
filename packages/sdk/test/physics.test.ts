import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ELECTRON_ENERGY_UNIT_EV, sampleWavefunction, solveBarrier, transmission, transmissionPpb } from "../src/physics";

// Same 50-digit reference values as programs/tunnel/src/physics.rs (scripts/physics-reference.py).
const REFERENCE: [number, number, number, number][] = [
  [0.5, 1.0, 1.0, 6.2929027363485367e-1],
  [0.2, 1.0, 0.9, 4.4424779662549124e-1],
  [0.8, 4.0, 1.5, 1.192415012281296e-2],
  [3.2, 4.0, 1.5, 1.6774375972769008e-1],
  [1.0, 2.0, 3.0, 9.8660371654401913e-3],
  [0.05, 10.0, 2.0, 2.6377138919177162e-7],
];

describe("closed-form transmission", () => {
  it("matches the high-precision reference", () => {
    for (const [e, v0, a, t] of REFERENCE) expect(Math.abs(transmission(e, v0, a) - t) / t).toBeLessThan(1e-12);
  });

  it("matches the program's fixed-point outputs exactly", () => {
    // Values asserted by programs/tunnel/src/physics.rs::ppb_fixed_point.
    expect(transmissionPpb(1_000, 900, 2_000)).toBe(444_247_797);
    expect(transmissionPpb(4_000, 1_500, 2_000)).toBe(11_924_150);
    expect(transmissionPpb(4_000, 1_500, 8_000)).toBe(167_743_760);
    expect(transmissionPpb(20_000, 5_000, 500)).toBeNull();
  });

  it("handles E → V₀, E → 0 and invalid input", () => {
    const [v0, a] = [2, 1.3];
    const at = transmission(v0, v0, a);
    expect(at).toBeCloseTo(1 / (1 + (v0 * a * a) / 4), 15);
    expect(Math.abs(transmission(v0 * (1 - 1e-10), v0, a) - at)).toBeLessThan(1e-8);
    expect(Math.abs(transmission(v0 * (1 + 1e-10), v0, a) - at)).toBeLessThan(1e-8);
    expect(transmission(1e-14, v0, a)).toBeLessThan(1e-12);
    expect(transmission(0, v0, a)).toBe(0);
    expect(transmission(-1, v0, a)).toBe(0);
    expect(transmission(1, 0, a)).toBe(0);
    expect(transmission(1, 1, 0)).toBe(0);
  });

  it("is a probability, monotone in E below the barrier and decreasing in V₀ and a", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        fc.double({ min: 0.1, max: 20, noNaN: true }),
        fc.double({ min: 0.1, max: 5, noNaN: true }),
        (frac, v0, a) => {
          const t = transmission(frac * v0, v0, a);
          expect(t).toBeGreaterThanOrEqual(0);
          expect(t).toBeLessThanOrEqual(1);
          expect(transmission(Math.min(0.999, frac + 0.005) * v0, v0, a)).toBeGreaterThanOrEqual(t);
          expect(transmission(frac * v0, v0, a * 1.05)).toBeLessThanOrEqual(t);
        },
      ),
    );
  });
});

describe("wavefunction solver (independent method)", () => {
  it("|t|² equals the closed form and |r|² + |t|² = 1 across the parameter space", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.02, max: 3, noNaN: true }),
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        fc.double({ min: 0.1, max: 4, noNaN: true }),
        (frac, v0, a) => {
          const s = solveBarrier(frac * v0, v0, a);
          const closed = transmission(frac * v0, v0, a);
          expect(Math.abs(s.T - closed)).toBeLessThan(1e-9 + 1e-7 * closed);
          expect(Math.abs(s.R + s.T - 1)).toBeLessThan(1e-9);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("produces a continuous ψ at both barrier edges", () => {
    for (const [e, v0, a] of [[0.4, 1, 1], [2.5, 2, 1.3], [1, 4, 1.5]]) {
      const s = solveBarrier(e, v0, a);
      const eps = 1e-9;
      for (const edge of [0, a]) {
        const [l, r] = sampleWavefunction(s, edge - eps, edge + eps, 2);
        expect(Math.abs(l.re - r.re)).toBeLessThan(1e-6);
        expect(Math.abs(l.im - r.im)).toBeLessThan(1e-6);
      }
    }
  });

  it("transmits perfectly at above-barrier resonance", () => {
    const [v0, a] = [2, 1.3];
    const e = v0 + (Math.PI / a) ** 2;
    expect(solveBarrier(e, v0, a).T).toBeCloseTo(1, 10);
  });

  it("exposes the electron energy unit (ħ²/2mₑ per Å²)", () => {
    expect(ELECTRON_ENERGY_UNIT_EV).toBeCloseTo(3.81, 2);
  });
});
