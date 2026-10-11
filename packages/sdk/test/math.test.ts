import { Keypair, PublicKey } from "@solana/web3.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../src/constants";
import {
  computePayout,
  deriveOdds,
  emissionCurve,
  mulDiv,
  nominalReward,
  particleDraw,
  particleOutcomes,
  scheduledEmission,
  successThreshold,
} from "../src/math";

describe("particle draws", () => {
  it("matches the Rust known vector", () => {
    // programs/tunnel/src/math.rs::known_vector (also checked with Python hashlib).
    const d = particleDraw(new Uint8Array(64).fill(1), 7n, new Uint8Array(32).fill(2), 1, 2, 3);
    expect(d).toBe(5_097_536_720_253_246_649n);
  });

  it("thresholds are exact at the boundaries", () => {
    expect(successThreshold(0)).toBe(0n);
    expect(successThreshold(500_000_000)).toBe(1n << 63n);
    expect(successThreshold(999_999_999) < (1n << 64n) - 1n).toBe(true);
  });

  it("success rates converge to the configured probability", () => {
    const r = new Uint8Array(64).fill(7);
    const owner = new Uint8Array(32).fill(3);
    for (const ppb of [650_000_000, 300_000_000, 20_000_000]) {
      const n = 20_000;
      const hits = particleOutcomes(r, 42n, owner, 1, 1, n, ppb).filter((o) => o.success).length;
      expect(Math.abs(hits / n - ppb / 1e9)).toBeLessThan(0.015);
    }
  });

  it("an experiment's outcomes are the matching slice of the whole cell", () => {
    const r = Uint8Array.from({ length: 64 }, (_, i) => i);
    const owner = Keypair.generate().publicKey.toBytes();
    const all = particleOutcomes(r, 9n, owner, 2, 3, 30, 99_808_621);
    const slice = particleOutcomes(r, 9n, owner, 2, 3, 10, 99_808_621, 15);
    expect(slice).toEqual(all.slice(15, 25));
  });
});

describe("odds and reward calibration", () => {
  const odds = deriveOdds(DEFAULT_PARAMS);

  it("matches the table the program derives (programs/tunnel/src/math.rs)", () => {
    expect(odds.transmissionPpb).toEqual([
      [444247797, 592587953, 683660453, 745092903, 789208405],
      [93406338, 172710376, 257433197, 344744636, 431633852],
      [11924150, 28485755, 55861437, 99808621, 167743760],
    ]);
    expect(odds.reward[0][0]).toBe(nominalReward(1_000_000n, 1, 9_500, 444247797));
  });

  it("gives every energy level the same expected reward per energy unit", () => {
    DEFAULT_PARAMS.barriers.forEach((b, bi) =>
      DEFAULT_PARAMS.levels.forEach((l, li) => {
        const ev = (Number(odds.reward[bi][li]) * odds.transmissionPpb[bi][li]) / 1e9 / l.cost;
        const target = (Number(DEFAULT_PARAMS.rewardPerEnergy) * b.rewardPremiumBps) / 1e4;
        expect(Math.abs(ev - target) / target).toBeLessThan(1e-6);
      }),
    );
  });

  it("rejects barriers too opaque to tunnel through", () => {
    expect(() =>
      deriveOdds({ ...DEFAULT_PARAMS, barriers: [DEFAULT_PARAMS.barriers[0], DEFAULT_PARAMS.barriers[1], { heightMilli: 20_000, widthMilli: 5_000, rewardPremiumBps: 10_000 }] }),
    ).toThrow();
  });
});

describe("payouts and emissions", () => {
  it("pays nominal rewards in full within budget and pro rata beyond it (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 0n, max: 10n ** 12n }), { minLength: 1, maxLength: 40 }),
        fc.bigInt({ min: 0n, max: 10n ** 13n }),
        (nominals, budget) => {
          const total = nominals.reduce((a, b) => a + b, 0n);
          const paid = nominals.map((n) => computePayout({ outcome: "rewards", totalNominal: total, emissionBudget: budget, positionNominal: n }));
          const sum = paid.reduce((a, b) => a + b, 0n);
          // Never exceeds the cycle budget nor any position's nominal reward.
          expect(sum <= (total < budget ? total : budget)).toBe(true);
          paid.forEach((p, i) => expect(p <= nominals[i]).toBe(true));
          if (total <= budget) expect(sum).toBe(total);
          // Rounding dust is at most one base unit per position.
          else expect(budget - sum <= BigInt(nominals.length)).toBe(true);
        },
      ),
    );
  });

  it("pays nothing for non-reward outcomes", () => {
    for (const outcome of ["noTunnels", "void", "empty", "pending"] as const) {
      expect(computePayout({ outcome, totalNominal: 10n, emissionBudget: 100n, positionNominal: 10n })).toBe(0n);
    }
  });

  it("decays the schedule per epoch and stays within the reserve placeholder", () => {
    expect(scheduledEmission(DEFAULT_PARAMS, 0n)).toBe(20_000_000_000n);
    expect(scheduledEmission(DEFAULT_PARAMS, 143n)).toBe(20_000_000_000n);
    expect(scheduledEmission(DEFAULT_PARAMS, 144n)).toBe(19_900_000_000n);
    const curve = emissionCurve(DEFAULT_PARAMS, 6000, 100);
    expect(curve.at(-1)!.cumulative < 600_000_000n * 10n ** 6n).toBe(true);
  });

  it("mulDiv is exact and guards overflow", () => {
    const max = (1n << 64n) - 1n;
    expect(mulDiv(max, max, max)).toBe(max);
    expect(() => mulDiv(max, 2n, 1n)).toThrow();
    expect(() => mulDiv(1n, 1n, 0n)).toThrow();
  });
});

describe("pda determinism", () => {
  it("derives distinct positions per cycle and owner", async () => {
    const { positionPda } = await import("../src/pda");
    const a = Keypair.generate().publicKey;
    expect(positionPda(1n, a).equals(positionPda(2n, a))).toBe(false);
    expect(positionPda(1n, a).equals(positionPda(1n, PublicKey.default))).toBe(false);
  });
});
