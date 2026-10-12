/** Instant betting against real PostgreSQL: balances, limits, concurrency, fairness, withdrawals. */
import type { PrismaClient } from "@tunnel/db";
import { TUNNEL_UNIT, VOLATILITY, hashServerSeed, resolveBet, tunnelToPlain, withdrawalMessage } from "@tunnel/sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { creditDeposit, ensureConfig, failPayout, placeBet, recordReserveFunding, requestWithdrawal, rotateSeed, setBetLimits } from "../src";
import { nonce, signer, startDb } from "./harness";

let db: PrismaClient;
let stop: () => Promise<void>;
beforeAll(async () => {
  ({ db, stop } = await startDb());
}, 60_000);
afterAll(async () => stop?.());

const T = TUNNEL_UNIT;
let sig = 0;
const deposit = (wallet: string, amount: bigint) => creditDeposit(db, { wallet, amount, txSignature: `tx${++sig}`, slot: 1n });

beforeEach(async () => {
  await db.$executeRawUnsafe(`TRUNCATE "Bet", "SeedPair", "Account", "Deposit", "Payout", "UsedNonce", "ProtocolEvent", "ProtocolConfig" RESTART IDENTITY CASCADE`);
  await ensureConfig(db);
  await db.protocolConfig.update({ where: { id: 1 }, data: { rewardWalletTokens: 10_000_000n * T, bettingPaused: false, minBet: 1n * T, maxBet: 1_000n * T } });
});

async function code(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
}
const balance = async (w: string) => (await db.account.findUniqueOrThrow({ where: { wallet: w } })).balance;

describe("deposits", () => {
  it("credits each transaction once", async () => {
    const a = signer();
    expect(await creditDeposit(db, { wallet: a.wallet, amount: 50n * T, txSignature: "same", slot: 1n })).toBe(true);
    expect(await creditDeposit(db, { wallet: a.wallet, amount: 50n * T, txSignature: "same", slot: 1n })).toBe(false);
    expect(await balance(a.wallet)).toBe(50n * T);
  });

  it("never credits vault funding as a player deposit", async () => {
    const operator = signer();
    await recordReserveFunding(db, 1_000n * T, "fund-tx", operator.wallet);
    expect(await creditDeposit(db, { wallet: operator.wallet, amount: 1_000n * T, txSignature: "fund-tx", slot: 1n })).toBe(false);
    expect(await creditDeposit(db, { wallet: operator.wallet, amount: 5n * T, txSignature: "later-top-up", slot: 2n })).toBe(false);
    expect(await db.account.findUnique({ where: { wallet: operator.wallet } })).toBeNull();
  });
});

describe("bets", () => {
  it("debits the stake, credits the payout and records a verifiable bet", async () => {
    const a = signer();
    await deposit(a.wallet, 100n * T);
    const r = await placeBet(db, a.wallet, { volatility: 0, amount: 2n * T, count: 10 });
    expect(r.stake).toBe(20n * T);
    expect(r.payout).toBe(BigInt(r.wins) * 2n * T * 186n / 100n);
    expect(await balance(a.wallet)).toBe(100n * T - 20n * T + r.payout);

    // After rotation the revealed seed reproduces the bet exactly.
    const { revealed, next } = await rotateSeed(db, a.wallet, "my-seed");
    expect(hashServerSeed(revealed.serverSeed!)).toBe(r.serverSeedHash);
    const again = resolveBet({ serverSeed: revealed.serverSeed!, clientSeed: r.clientSeed, nonce: r.bet.nonce, volatility: 0, amount: 2n * T, count: 10 });
    expect(again.hits).toEqual(r.hits);
    expect(next.clientSeed).toBe("my-seed");
    expect(next.serverSeed).toBeNull();
  });

  it("increments the nonce per bet", async () => {
    const a = signer();
    await deposit(a.wallet, 100n * T);
    const n = [];
    for (let i = 0; i < 3; i++) n.push((await placeBet(db, a.wallet, { volatility: 1, amount: 1n * T, count: 1 })).bet.nonce);
    expect(n).toEqual([0, 1, 2]);
  });

  it("never overdraws under concurrent bets", async () => {
    const a = signer();
    await deposit(a.wallet, 10n * T);
    // HIGH volatility rarely pays, so most bets lose their stake; at most 10 can be funded.
    const results = await Promise.allSettled(Array.from({ length: 16 }, () => placeBet(db, a.wallet, { volatility: 2, amount: 1n * T, count: 1 })));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const acct = await db.account.findUniqueOrThrow({ where: { wallet: a.wallet } });
    expect(acct.balance >= 0n).toBe(true);
    expect(acct.wagered).toBe(BigInt(ok) * T);
    expect(acct.balance).toBe(10n * T - acct.wagered + acct.returned);
  });

  it("enforces balance, limits, max win, particle count and pause", async () => {
    const a = signer();
    expect(await code(placeBet(db, a.wallet, { volatility: 0, amount: 1n * T, count: 1 }))).toBe("balance");
    await deposit(a.wallet, 5_000n * T);
    expect(await code(placeBet(db, a.wallet, { volatility: 0, amount: T / 2n, count: 1 }))).toBe("bad_bet");
    expect(await code(placeBet(db, a.wallet, { volatility: 0, amount: 2_000n * T, count: 1 }))).toBe("bad_bet");
    expect(await code(placeBet(db, a.wallet, { volatility: 0, amount: 1n * T, count: 0 }))).toBe("bad_bet");
    expect(await code(placeBet(db, a.wallet, { volatility: 3, amount: 1n * T, count: 1 }))).toBe("bad_bet");
    await db.protocolConfig.update({ where: { id: 1 }, data: { rewardWalletTokens: 6_000n * T } }); // tiny free bankroll
    expect(await code(placeBet(db, a.wallet, { volatility: 2, amount: 100n * T, count: 5 }))).toBe("max_win");
    await setBetLimits(db, { bettingPaused: true }, "admin");
    expect(await code(placeBet(db, a.wallet, { volatility: 0, amount: 1n * T, count: 1 }))).toBe("paused");
  });

  it("uses the configured odds", () => {
    expect(VOLATILITY.map((v) => v.multiplierBps)).toEqual([18_600, 46_500, 186_000]);
  });
});

describe("withdrawals", () => {
  const sign = (s: ReturnType<typeof signer>, amount: bigint) => {
    const message = withdrawalMessage({ wallet: s.wallet, amount: tunnelToPlain(amount), nonce: nonce(), issuedAt: new Date().toISOString() });
    return { message, signature: s.sign(message) };
  };

  it("debits the balance, blocks a second request and re-credits on failure", async () => {
    const a = signer();
    await deposit(a.wallet, 30n * T);
    const w = await requestWithdrawal(db, sign(a, 12_500_000n));
    expect(w.amount).toBe(12_500_000n);
    expect(await balance(a.wallet)).toBe(30n * T - 12_500_000n);
    expect(await code(requestWithdrawal(db, sign(a, 1n * T)))).toBe("withdrawal_pending");
    await failPayout(db, w.payoutId, "simulated");
    expect(await balance(a.wallet)).toBe(30n * T);
  });

  it("rejects overdrafts, forged signatures and replays", async () => {
    const a = signer();
    const b = signer();
    await deposit(a.wallet, 5n * T);
    expect(await code(requestWithdrawal(db, sign(a, 6n * T)))).toBe("balance");
    const s = sign(a, 1n * T);
    expect(await code(requestWithdrawal(db, { message: s.message, signature: b.sign(s.message) }))).toBe("bad_signature");
    await requestWithdrawal(db, s);
    expect(await code(requestWithdrawal(db, s))).toBe("replay");
  });
});
