import "server-only";
import { activeSeedPair, casinoLimits, publicSeedPair } from "@tunnel/core";
import type { getDb } from "@tunnel/db";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, readSession } from "./session";

type Db = ReturnType<typeof getDb>;

/** The wallet signed in via Sign-In With Solana (HttpOnly session cookie), or null. */
export const sessionWallet = (req: NextRequest) => readSession(req.cookies.get(SESSION_COOKIE)?.value);

/** Rejects cross-site POSTs (defence in depth on top of the SameSite=Strict cookie). */
export { crossOrigin } from "./http";

type BetRow = NonNullable<Awaited<ReturnType<Db["bet"]["findUnique"]>>>;
export const betDto = (b: BetRow) => ({
  id: b.id,
  wallet: b.wallet,
  volatility: b.volatility,
  amount: b.amount,
  count: b.count,
  stake: b.amount * BigInt(b.count),
  wins: b.wins,
  payout: b.payout,
  multiplierBps: b.multiplierBps,
  winPpb: b.winPpb,
  outcomeBits: b.outcomeBits,
  nonce: b.nonce,
  createdAt: b.createdAt,
});

export async function casinoState(db: Db) {
  const [limits, cfg, agg, biggest] = await Promise.all([
    casinoLimits(db),
    db.protocolConfig.findUnique({ where: { id: 1 }, select: { rewardWallet: true, tunnelMint: true, engineHeartbeat: true } }),
    db.bet.aggregate({ _count: { _all: true }, _sum: { count: true, wins: true } }),
    db.bet.findFirst({ orderBy: [{ payout: "desc" }, { id: "asc" }], select: { payout: true } }),
  ]);
  const [wagered] = await db.$queryRaw<{ total: bigint | null }[]>`SELECT SUM("amount" * "count")::bigint AS total FROM "Bet"`;
  const engineOnline = !!cfg?.engineHeartbeat && Date.now() - cfg.engineHeartbeat.getTime() < 30_000;
  return {
    now: Date.now(),
    bettingOpen: !limits.bettingPaused && engineOnline && limits.freeBankroll != null,
    minBet: limits.minBet,
    maxBet: limits.maxBet,
    /** Largest net win a single bet may have right now. */
    maxWin: limits.freeBankroll == null ? null : (limits.freeBankroll * BigInt(limits.maxWinBps)) / 10_000n,
    depositAddress: cfg?.rewardWallet ?? null,
    tunnelMint: cfg?.tunnelMint ?? null,
    engineOnline,
    totals: { bets: agg._count._all, particles: agg._sum.count ?? 0, hits: agg._sum.wins ?? 0, wagered: wagered?.total ?? 0n, biggestWin: biggest?.payout ?? 0n },
  };
}

export async function playerState(db: Db, wallet: string) {
  const [account, seed, bets, withdrawals, deposits] = await Promise.all([
    db.account.findUnique({ where: { wallet } }),
    activeSeedPair(db, wallet),
    db.bet.findMany({ where: { wallet }, orderBy: { id: "desc" }, take: 30 }),
    db.payout.findMany({
      where: { wallet, kind: "withdrawal" },
      orderBy: { id: "desc" },
      take: 10,
      select: { id: true, amount: true, status: true, txSignature: true, createdAt: true, confirmedAt: true },
    }),
    db.deposit.findMany({ where: { wallet }, orderBy: { id: "desc" }, take: 10, select: { id: true, amount: true, txSignature: true, createdAt: true } }),
  ]);
  return { wallet, balance: account?.balance ?? 0n, account, seed: publicSeedPair(seed), bets: bets.map(betDto), withdrawals, deposits };
}
