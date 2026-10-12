/**
 * End-to-end protocol behaviour against real PostgreSQL: deployments,
 * energy limits, replay protection, cycle lifecycle, settlement (checked
 * with the public verifier), reserve accounting and claims.
 */
import type { PrismaClient } from "@tunnel/db";
import { DEFAULT_PARAMS, TUNNEL_UNIT, fromHex, oddsFromJson, unflatten, verifyCycle, type OddsTableJson } from "@tunnel/sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimableFor,
  closeDueCycles,
  confirmPayout,
  deploy,
  ensureConfig,
  failPayout,
  loadConfig,
  markSending,
  openCycle,
  publicCycle,
  recomputeWalletStats,
  recordReserveFunding,
  requestClaim,
  setPaused,
  setParams,
  settleCycle,
  voidCycle,
} from "../src";
import { fakeBlockhash, signer, startDb } from "./harness";

let db: PrismaClient;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, stop } = await startDb());
}, 60_000);
afterAll(async () => stop?.());

async function reset() {
  await db.$executeRawUnsafe(
    `TRUNCATE "Payout", "Experiment", "Position", "Cycle", "ProtocolEvent", "WalletStats", "UsedNonce", "User", "ProtocolConfig" RESTART IDENTITY CASCADE`,
  );
  await ensureConfig(db);
  await recordReserveFunding(db, 1_000_000n * TUNNEL_UNIT, "test-funding", "admin");
  await setPaused(db, false, "admin");
}

const SLOT = 1_000n;
async function open(now = new Date()) {
  const r = await openCycle(db, now, SLOT);
  if (!r.opened) throw new Error(r.reason);
  return r.id;
}

async function errorCode(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
}

describe("deployments", () => {
  beforeEach(reset);

  it("records a signed deployment and spends energy", async () => {
    const id = await open();
    const a = signer();
    const r = await deploy(db, a.deployment(id, 1, 2, 10));
    expect(r).toMatchObject({ cycleId: id, seq: 0, firstIndex: 0, energyCost: 30, energyUsed: 30, energyPerCycle: 100 });
    const r2 = await deploy(db, a.deployment(id, 1, 2, 5));
    expect(r2).toMatchObject({ seq: 1, firstIndex: 10, energyUsed: 45 });
    const pos = await db.position.findUniqueOrThrow({ where: { cycleId_wallet: { cycleId: id, wallet: a.wallet } } });
    expect(pos.particles[7]).toBe(15);
    const cycle = await db.cycle.findUniqueOrThrow({ where: { id } });
    expect(cycle).toMatchObject({ participants: 1, experiments: 2, energyUsed: 45n });
    expect(cycle.particles).toEqual([0n, 15n, 0n]);
  });

  it("enforces the per-cycle energy allowance", async () => {
    const id = await open();
    const a = signer();
    await deploy(db, a.deployment(id, 0, 4, 19)); // 95
    expect(await errorCode(deploy(db, a.deployment(id, 0, 1, 3)))).toBe("energy"); // +6
    await deploy(db, a.deployment(id, 0, 0, 5)); // exactly 100
    expect(await errorCode(deploy(db, a.deployment(id, 0, 0, 1)))).toBe("energy");
  });

  it("never lets concurrent deployments exceed the allowance", async () => {
    const id = await open();
    const a = signer();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => deploy(db, a.deployment(id, 2, 4, 5)))); // 25 energy each
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    const pos = await db.position.findUniqueOrThrow({ where: { cycleId_wallet: { cycleId: id, wallet: a.wallet } } });
    expect(pos.energyUsed).toBe(100);
  });

  it("rejects replays, forged signatures, stale messages, closed cycles and paused mining", async () => {
    const id = await open();
    const a = signer();
    const b = signer();
    const signed = a.deployment(id, 0, 0, 1);
    await deploy(db, signed);
    expect(await errorCode(deploy(db, signed))).toBe("replay");
    expect(await errorCode(deploy(db, { message: signed.message, signature: b.sign(signed.message) }))).toBe("bad_signature");
    expect(await errorCode(deploy(db, { ...signed, message: signed.message.replace("Particles: 1", "Particles: 9") }))).toBe("bad_signature");
    expect(await errorCode(deploy(db, a.deployment(id, 0, 0, 1, new Date(Date.now() - 10 * 60_000))))).toBe("stale_message");
    expect(await errorCode(deploy(db, a.deployment(id, 0, 0, 101)))).toBe("bad_message");
    expect(await errorCode(deploy(db, a.deployment(id + 5n, 0, 0, 1)))).toBe("no_cycle");

    await closeDueCycles(db, new Date(Date.now() + 601_000), SLOT);
    expect(await errorCode(deploy(db, a.deployment(id, 0, 0, 1)))).toBe("cycle_closed");

    await setPaused(db, true, "admin");
    expect(await errorCode(deploy(db, a.deployment(id, 0, 0, 1)))).toBe("paused");
  });

  it("closes early when the chain nears the entropy slot", async () => {
    const id = await open();
    const c = await db.cycle.findUniqueOrThrow({ where: { id } });
    expect(c.entropySlot).toBe(SLOT + 1_538n); // (600 s + 15 s margin) / 0.4 s
    expect(await closeDueCycles(db, new Date(), c.entropySlot - 31n)).toEqual([]);
    expect(await closeDueCycles(db, new Date(), c.entropySlot - 30n)).toEqual([id]);
  });
});

describe("settlement", () => {
  beforeEach(reset);

  it("settles verifiably and keeps the seed secret until then", async () => {
    const id = await open();
    const players = [signer(), signer(), signer()];
    for (const [i, p] of players.entries()) {
      await deploy(db, p.deployment(id, 0, 4, 10));
      await deploy(db, p.deployment(id, i % 3, 2, 8));
      await deploy(db, p.deployment(id, 2, 0, 26));
    }
    const openRow = await db.cycle.findUniqueOrThrow({ where: { id } });
    expect(publicCycle(openRow).serverSeed).toBeNull();

    await closeDueCycles(db, new Date(Date.now() + 601_000), SLOT + 10n);
    const bh = fakeBlockhash();
    const res = await settleCycle(db, id, { slot: openRow.entropySlot + 2n, blockhash: bh });
    expect(res?.outcome).toBe("rewards");
    expect(await settleCycle(db, id, { slot: 1n, blockhash: fakeBlockhash() })).toBeNull(); // idempotent

    const cycle = await db.cycle.findUniqueOrThrow({ where: { id } });
    expect(publicCycle(cycle).serverSeed).toBe(cycle.serverSeed);
    expect(cycle.entropyBlockhash).toBe(bh);
    const positions = await db.position.findMany({ where: { cycleId: id } });
    const v = verifyCycle(
      {
        id,
        barriers: cycle.barriers as never,
        levels: cycle.levels as never,
        odds: oddsFromJson(cycle.odds as unknown as OddsTableJson),
        emissionBudget: cycle.emissionBudget,
        totalNominal: cycle.totalNominal,
        outcome: cycle.outcome as never,
        seedCommitment: cycle.seedCommitment,
        serverSeed: cycle.serverSeed,
        entropyBlockhash: cycle.entropyBlockhash,
        randomness: cycle.randomness,
      },
      positions.map((p) => ({ wallet: p.wallet, particles: unflatten(p.particles), successes: unflatten(p.successes), nominalReward: p.nominalReward, payout: p.payout })),
    );
    expect(v.allMatch).toBe(true);
    expect(fromHex(cycle.randomness!)).toHaveLength(64);

    const paid = positions.reduce((s, p) => s + (p.payout ?? 0n), 0n);
    expect(paid).toBe(cycle.tokensAllocated);
    expect(paid <= cycle.emissionBudget).toBe(true);

    // Experiment outcome bits partition the position's successes.
    const exps = await db.experiment.findMany({ where: { cycleId: id } });
    for (const p of positions) {
      const mine = exps.filter((e) => e.wallet === p.wallet);
      expect(mine.reduce((s, e) => s + (e.successes ?? 0), 0)).toBe(p.successes.reduce((a, b) => a + b, 0));
      for (const e of mine) expect(e.outcomeBits).toHaveLength(e.count);
    }
  });

  it("caps the cycle budget by the funded reserve and stops when it runs out", async () => {
    await db.protocolConfig.update({ where: { id: 1 }, data: { reserveFundedTotal: 25_000n * TUNNEL_UNIT } });
    const first = await open();
    expect((await db.cycle.findUniqueOrThrow({ where: { id: first } })).emissionBudget).toBe(DEFAULT_PARAMS.initialEmissionPerCycle);
    await closeDueCycles(db, new Date(Date.now() + 601_000), SLOT);
    const second = await open(new Date(Date.now() + 602_000));
    expect((await db.cycle.findUniqueOrThrow({ where: { id: second } })).emissionBudget).toBe(5_000n * TUNNEL_UNIT);
    await closeDueCycles(db, new Date(Date.now() + 1_300_000), SLOT);
    expect(await openCycle(db, new Date(Date.now() + 1_300_000), SLOT)).toEqual({ opened: false, reason: "reserve_exhausted" });
    // An empty settled cycle allocates nothing, so its budget returns to the reserve.
    await settleCycle(db, first, { slot: 5_000n, blockhash: fakeBlockhash() });
    const third = await openCycle(db, new Date(Date.now() + 1_400_000), SLOT);
    expect(third.opened).toBe(true);
  });

  it("voids without paying and reveals the seed", async () => {
    const id = await open();
    const a = signer();
    await deploy(db, a.deployment(id, 0, 0, 3));
    await closeDueCycles(db, new Date(Date.now() + 601_000), SLOT);
    expect(await voidCycle(db, id, "entropy unavailable")).toBe(true);
    const c = await db.cycle.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ status: "void", outcome: "void" });
    expect(publicCycle(c).serverSeed).toBe(c.serverSeed);
    expect((await claimableFor(db, a.wallet)).amount).toBe(0n);
  });

  it("does not open cycles while paused", async () => {
    await setPaused(db, true, "admin");
    expect(await openCycle(db, new Date(), SLOT)).toEqual({ opened: false, reason: "paused" });
  });

  it("rejects params whose physics leaves the probability bounds", async () => {
    const bad = { ...DEFAULT_PARAMS, barriers: [DEFAULT_PARAMS.barriers[0], DEFAULT_PARAMS.barriers[1], { heightMilli: 20_000, widthMilli: 5_000, rewardPremiumBps: 10_000 }] as typeof DEFAULT_PARAMS.barriers };
    expect(await errorCode(setParams(db, bad, "admin"))).toBe("bad_params");
    expect((await loadConfig(db)).params.barriers[2].heightMilli).toBe(4_000);
  });
});

describe("claims", () => {
  beforeEach(reset);

  async function settledWinner() {
    const id = await open();
    const a = signer();
    await deploy(db, a.deployment(id, 0, 4, 20)); // 79% each — essentially certain to win something
    await closeDueCycles(db, new Date(Date.now() + 601_000), SLOT);
    await settleCycle(db, id, { slot: 5_000n, blockhash: fakeBlockhash() });
    return { id, a };
  }

  it("bundles claimable cycles into one payout and blocks double claims", async () => {
    const { a } = await settledWinner();
    const { amount } = await claimableFor(db, a.wallet);
    expect(amount > 0n).toBe(true);
    const r = await requestClaim(db, a.claim());
    expect(r.amount).toBe(amount);
    expect(await errorCode(requestClaim(db, a.claim()))).toBe("claim_pending");
    expect((await claimableFor(db, a.wallet)).amount).toBe(0n);

    expect(await markSending(db, r.payoutId, "sig1", 100n)).toBe(true);
    expect(await markSending(db, r.payoutId, "sig2", 100n)).toBe(false); // never twice
    await confirmPayout(db, r.payoutId);
    expect(await errorCode(requestClaim(db, a.claim()))).toBe("nothing_to_claim");

    await recomputeWalletStats(db, a.wallet);
    const stats = await db.walletStats.findUniqueOrThrow({ where: { owner: a.wallet } });
    expect(stats.tokensClaimed).toBe(amount);
    expect(stats.tokensEarned).toBe(amount);
    expect(stats.claimableCycles).toBe(0);
    expect((await db.experiment.findFirstOrThrow({ where: { wallet: a.wallet } })).status).toBe("claimed");
  });

  it("returns a failed payout to the claimable balance", async () => {
    const { a } = await settledWinner();
    const r = await requestClaim(db, a.claim());
    await failPayout(db, r.payoutId, "simulated failure");
    expect((await claimableFor(db, a.wallet)).amount).toBe(r.amount);
    const again = await requestClaim(db, a.claim());
    expect(again.amount).toBe(r.amount);
  });

  it("only the wallet owner can claim", async () => {
    const { a } = await settledWinner();
    const b = signer();
    const msg = a.claim().message;
    expect(await errorCode(requestClaim(db, { message: msg, signature: b.sign(msg) }))).toBe("bad_signature");
    expect(await errorCode(requestClaim(db, b.claim()))).toBe("nothing_to_claim");
  });
});
