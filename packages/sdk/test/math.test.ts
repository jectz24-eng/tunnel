import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, TUNNEL_MINING_RESERVE } from "../src/constants";
import {
  computePayout,
  countSuccesses,
  emissionCurve,
  mulDiv,
  particleDraw,
  scheduledEmission,
  splitFee,
  successThreshold,
} from "../src/math";

const U64_MAX = (1n << 64n) - 1n;

describe("successThreshold", () => {
  it("matches floor(bps · 2^64 / 10^4)", () => {
    expect(successThreshold(0)).toBe(0n);
    expect(successThreshold(5000)).toBe(1n << 63n);
    expect(successThreshold(6500)).toBe(((6500n << 64n) / 10000n));
  });
  it("is monotonic", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 9998 }), (b) => successThreshold(b) < successThreshold(b + 1)));
  });
});

describe("particleDraw", () => {
  const r = new Uint8Array(64).fill(1);
  const owner = new Uint8Array(32).fill(2);

  it("matches the Rust known vector bit-for-bit", () => {
    expect(particleDraw(r, 7n, owner, 1, 3)).toBe(2_211_064_809_742_104_174n);
  });

  it("is deterministic and input-sensitive", () => {
    const d = particleDraw(r, 7n, owner, 1, 3);
    expect(particleDraw(r, 7n, owner, 1, 3)).toBe(d);
    expect(particleDraw(r, 7n, owner, 1, 4)).not.toBe(d);
    expect(particleDraw(r, 8n, owner, 1, 3)).not.toBe(d);
    expect(particleDraw(r, 7n, owner, 2, 3)).not.toBe(d);
  });

  it("produces success rates that match configured odds", () => {
    const n = 20_000;
    for (const [barrier, bps] of [[0, 6500], [1, 3000], [2, 1000]] as const) {
      const s = countSuccesses(r, 42n, owner, barrier, n, bps);
      expect(Math.abs(s / n - bps / 10_000)).toBeLessThan(0.015);
    }
  });

  it("rejects malformed inputs", () => {
    expect(() => particleDraw(new Uint8Array(63), 0n, owner, 0, 0)).toThrow();
    expect(() => particleDraw(r, 0n, new Uint8Array(31), 0, 0)).toThrow();
  });
});

describe("mulDiv / splitFee", () => {
  it("never loses or creates lamports in the fee split", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: U64_MAX / 2n }), fc.integer({ min: 0, max: 1000 }), (total, bps) => {
        const { fee, distributable } = splitFee(total, bps);
        return fee + distributable === total && fee >= 0n && distributable >= 0n;
      }),
    );
  });
  it("handles u64 extremes like the Rust implementation", () => {
    expect(mulDiv(U64_MAX, U64_MAX, U64_MAX)).toBe(U64_MAX);
    expect(() => mulDiv(U64_MAX, 2n, 1n)).toThrow();
    expect(() => mulDiv(1n, 1n, 0n)).toThrow();
  });
  it("5% of a 1 SOL pool is 0.05 SOL", () => {
    expect(splitFee(1_000_000_000n, 500)).toEqual({ fee: 50_000_000n, distributable: 950_000_000n });
  });
});

describe("payouts", () => {
  it("never pays out more than the pool, across any set of positions", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ lamports: fc.bigInt({ min: 1n, max: 10n ** 12n }), weight: fc.bigInt({ min: 0n, max: 1000n }) }), {
          minLength: 1,
          maxLength: 50,
        }),
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        (positions, budget) => {
          const total = positions.reduce((a, p) => a + p.lamports, 0n);
          const totalWeight = positions.reduce((a, p) => a + p.weight, 0n);
          const { distributable } = splitFee(total, 500);
          const outcome = totalWeight === 0n ? "noSuccessRefund" : "rewards";
          let paidSol = 0n;
          let paidTok = 0n;
          for (const p of positions) {
            const r = computePayout({
              outcome,
              distributableLamports: distributable,
              totalLamports: total,
              totalSuccessWeight: totalWeight,
              emissionBudget: budget,
              positionLamports: p.lamports,
              positionSuccessWeight: p.weight,
            })!;
            paidSol += r.lamports;
            paidTok += r.tokens;
          }
          return paidSol <= distributable && paidTok <= budget && distributable - paidSol < BigInt(positions.length);
        },
      ),
    );
  });

  it("a Barrier III success earns 5× a Barrier I success in the same round", () => {
    const base = { outcome: "rewards" as const, distributableLamports: 950_000_000n, totalLamports: 10n ** 9n, totalSuccessWeight: 6n, emissionBudget: 600n, positionLamports: 0n };
    const one = computePayout({ ...base, positionSuccessWeight: 1n })!;
    const five = computePayout({ ...base, positionSuccessWeight: 5n })!;
    // floor division: 5 · floor(x/6) ≤ floor(5x/6) < 5 · floor(x/6) + 5
    expect(five.lamports >= one.lamports * 5n && five.lamports < one.lamports * 5n + 5n).toBe(true);
    expect(five.tokens).toBe(500n);
    expect(one.tokens).toBe(100n);
  });

  it("failed rounds refund 100% with no fee", () => {
    expect(
      computePayout({ outcome: "fullRefund", distributableLamports: 0n, totalLamports: 0n, totalSuccessWeight: 0n, emissionBudget: 0n, positionLamports: 123n, positionSuccessWeight: 0n }),
    ).toEqual({ lamports: 123n, tokens: 0n });
  });

  it("nothing is claimable before settlement", () => {
    expect(
      computePayout({ outcome: "pending", distributableLamports: 0n, totalLamports: 0n, totalSuccessWeight: 0n, emissionBudget: 0n, positionLamports: 1n, positionSuccessWeight: 0n }),
    ).toBeNull();
  });
});

describe("emission schedule", () => {
  it("matches the Rust unit-test vectors", () => {
    expect(scheduledEmission(DEFAULT_PARAMS, 0n)).toBe(416_000_000n);
    expect(scheduledEmission(DEFAULT_PARAMS, 1439n)).toBe(416_000_000n);
    expect(scheduledEmission(DEFAULT_PARAMS, 1440n)).toBe(415_584_000n);
  });
  it("is non-increasing", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 7n }), (r) => scheduledEmission(DEFAULT_PARAMS, r + 1440n) <= scheduledEmission(DEFAULT_PARAMS, r)),
    );
  });
  it("the default schedule never exceeds the 600M mining reserve", () => {
    const curve = emissionCurve(DEFAULT_PARAMS, 40_000, 1000);
    const last = curve[curve.length - 1];
    expect(last.cumulative).toBeLessThanOrEqual(TUNNEL_MINING_RESERVE);
    expect(last.cumulative).toBeGreaterThan((TUNNEL_MINING_RESERVE * 99n) / 100n);
  });
});
