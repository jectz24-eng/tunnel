import "server-only";
import type { getDb } from "@tunnel/db";

type Db = ReturnType<typeof getDb>;

export async function protocolSummary(db: Db) {
  const [state, rounds, participants, lastEvent] = await Promise.all([
    db.protocolState.findUnique({ where: { id: 1 } }),
    db.round.count(),
    db.walletStats.count(),
    db.indexedEvent.findFirst({ orderBy: { id: "desc" }, select: { blockTime: true, slot: true } }),
  ]);
  return { state, rounds, participants, lastEvent };
}

export async function roundSeries(db: Db, limit: number) {
  const rows = await db.round.findMany({
    where: { status: { in: ["settled", "failed"] }, outcome: { not: "empty" } },
    orderBy: { id: "desc" },
    take: limit,
  });
  return rows.reverse().map((r) => ({
    id: r.id,
    openTs: r.openTs,
    outcome: r.outcome,
    totalLamports: r.totalLamports,
    participants: r.participants,
    particles: r.particles,
    successes: r.successes,
    barrierBps: r.barrierBps,
    feeLamports: r.feeLamports,
    tokensAllocated: r.tokensAllocated,
  }));
}

export async function recentRounds(db: Db, limit: number, before?: bigint) {
  return db.round.findMany({
    where: before != null ? { id: { lt: before } } : undefined,
    orderBy: { id: "desc" },
    take: limit,
  });
}

export async function activity(db: Db, limit: number, afterId?: bigint) {
  const events = await db.indexedEvent.findMany({
    where: {
      name: { in: ["ParticlesDeployed", "RewardClaimed", "RoundFinalized", "RoundOpened", "RoundClosed", "RandomnessRevealed", "RoundFailed"] },
      ...(afterId != null ? { id: { gt: afterId } } : {}),
    },
    orderBy: { id: "desc" },
    take: limit,
  });
  return events.map((e) => ({
    id: e.id,
    name: e.name,
    signature: e.signature,
    roundId: e.roundId,
    owner: e.owner,
    blockTime: e.blockTime,
    commitment: e.commitment,
    data: e.data,
  }));
}

export type LeaderSort = "tokens" | "successes" | "particles" | "rate" | "sol";

/** Leaderboard derived from indexed positions; `since` filters by round open time. */
export async function leaderboard(db: Db, opts: { sort: LeaderSort; since?: Date; barrier?: number; limit: number }) {
  const positions = await db.position.findMany({
    where: opts.since ? { round: { openTs: { gte: opts.since } } } : undefined,
    select: {
      owner: true,
      particles: true,
      successes: true,
      settled: true,
      claimed: true,
      lamportsPaid: true,
      tokensPaid: true,
      expectedLamports: true,
      expectedTokens: true,
      round: { select: { outcome: true } },
    },
  });
  const by = new Map<string, { owner: string; particles: bigint; successes: bigint; settledParticles: bigint; tokens: bigint; solRewards: bigint; rounds: number }>();
  for (const p of positions) {
    const bIdx = opts.barrier;
    const parts = bIdx != null ? p.particles[bIdx] ?? 0 : p.particles.reduce((a, b) => a + b, 0);
    if (parts === 0) continue;
    const succ = bIdx != null ? p.successes[bIdx] ?? 0 : p.successes.reduce((a, b) => a + b, 0);
    const row = by.get(p.owner) ?? { owner: p.owner, particles: 0n, successes: 0n, settledParticles: 0n, tokens: 0n, solRewards: 0n, rounds: 0 };
    row.rounds++;
    row.particles += BigInt(parts);
    if (p.settled) {
      row.settledParticles += BigInt(parts);
      row.successes += BigInt(succ);
    }
    // Rewards are only meaningful for rounds that paid rewards (not refunds).
    if (p.round.outcome === "rewards" && bIdx == null) {
      row.tokens += p.claimed ? p.tokensPaid : (p.expectedTokens ?? 0n);
      row.solRewards += p.claimed ? p.lamportsPaid : (p.expectedLamports ?? 0n);
    }
    by.set(p.owner, row);
  }
  const rows = [...by.values()].map((r) => ({
    ...r,
    rateBps: r.settledParticles > 0n ? Number((r.successes * 10_000n) / r.settledParticles) : null,
  }));
  const key = (r: (typeof rows)[number]): number | bigint =>
    opts.sort === "tokens" ? r.tokens : opts.sort === "successes" ? r.successes : opts.sort === "particles" ? r.particles : opts.sort === "sol" ? r.solRewards : (r.rateBps ?? -1);
  rows.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return x === y ? (a.owner < b.owner ? -1 : 1) : x < y ? 1 : -1;
  });
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

export async function walletHistory(db: Db, owner: string) {
  const [stats, positions, deposits, claims] = await Promise.all([
    db.walletStats.findUnique({ where: { owner } }),
    db.position.findMany({ where: { owner }, include: { round: true }, orderBy: { roundId: "desc" }, take: 500 }),
    db.deposit.findMany({ where: { owner }, orderBy: { slot: "desc" }, take: 500 }),
    db.claim.findMany({ where: { owner }, orderBy: { slot: "desc" }, take: 500 }),
  ]);
  return {
    stats,
    positions: positions.map((p) => ({
      roundId: p.roundId,
      openTs: p.round.openTs,
      status: p.round.status,
      outcome: p.round.outcome,
      particles: p.particles,
      successes: p.successes,
      lamports: p.lamports,
      settled: p.settled,
      claimed: p.claimed,
      lamportsPaid: p.lamportsPaid,
      tokensPaid: p.tokensPaid,
      expectedLamports: p.expectedLamports,
      expectedTokens: p.expectedTokens,
    })),
    deposits,
    claims,
  };
}
