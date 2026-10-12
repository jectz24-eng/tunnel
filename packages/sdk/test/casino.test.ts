import { describe, expect, it } from "vitest";
import { VOLATILITY, formatChance, formatMultiplier, hashServerSeed, particleDrawFor, resolveBet } from "../src/casino";

const seed = "11".repeat(32);

describe("instant bets", () => {
  it("is deterministic and depends on every input", () => {
    const a = particleDrawFor(seed, "client", 0, 0);
    expect(particleDrawFor(seed, "client", 0, 0)).toBe(a);
    expect(particleDrawFor(seed, "client", 1, 0)).not.toBe(a);
    expect(particleDrawFor(seed, "client", 0, 1)).not.toBe(a);
    expect(particleDrawFor(seed, "other", 0, 0)).not.toBe(a);
    expect(particleDrawFor("22".repeat(32), "client", 0, 0)).not.toBe(a);
  });

  it("hits each level's probability", () => {
    VOLATILITY.forEach((v, vi) => {
      let wins = 0;
      const n = 4_000;
      for (let nonce = 0; nonce < n / 20; nonce++) wins += resolveBet({ serverSeed: seed, clientSeed: "x", nonce, volatility: vi, amount: 1n, count: 20 }).wins;
      expect(Math.abs(wins / n - v.ppb / 1e9)).toBeLessThan(0.025);
    });
  });

  it("pays amount × multiplier per tunneled particle", () => {
    const r = resolveBet({ serverSeed: seed, clientSeed: "c", nonce: 3, volatility: 0, amount: 1_000_000n, count: 20 });
    expect(r.hits).toHaveLength(20);
    expect(r.payout).toBe(BigInt(r.wins) * 1_860_000n);
  });

  it("formats odds for display", () => {
    expect(VOLATILITY.map((v) => [formatChance(v.ppb), formatMultiplier(v.multiplierBps)])).toEqual([
      ["50%", "1.86×"],
      ["20%", "4.65×"],
      ["5%", "18.6×"],
    ]);
    expect(hashServerSeed(seed)).toMatch(/^[0-9a-f]{64}$/);
  });
});
