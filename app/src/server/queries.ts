import "server-only";
import type { getDb } from "@tunnel/db";

type Db = ReturnType<typeof getDb>;

const TERMINAL = ["settled", "void"];

export async function protocolSummary(db: Db) {
  const [state, cycles, users, experiments, settledExperiments, lastEvent] = await Promise.all([
    db.protocolState.findUnique({ where: { id: 1 } }),
    db.cycle.count(),
    db.user.count(),
    db.experiment.count(),
    db.experiment.count({ where: { status: { in: ["settled", "claimed"] } } }),
    db.indexedEvent.findFirst({ orderBy: { id: "desc" }, select: { blockTime: true, slot: true } }),
  ]);
  return { state, cycles, users, experiments, settledExperiments, lastEvent };
}

/** Per-cycle series for charts (final cycles with participants only). */
export async function cycleSeries(db: Db, limit: number) {
  const rows = await db.cycle.findMany({
    where: { status: { in: TERMINAL }, outcome: { not: "empty" } },
    orderBy: { id: "desc" },
    take: limit,
  });
  return rows.reverse().map((c) => ({
    id: c.id,
    openTs: c.openTs,
    outcome: c.outcome,
    participants: c.participants,
    experiments: c.experiments,
    particles: c.particles,
    successes: c.successes,
    energyUsed: c.energyUsed,
    emissionBudget: c.emissionBudget,
    totalNominal: c.totalNominal,
    tokensAllocated: c.tokensAllocated,
  }));
}

export async function recentCycles(db: Db, limit: number, before?: bigint) {
  return db.cycle.findMany({ where: before != null ? { id: { lt: before } } : undefined, orderBy: { id: "desc" }, take: limit });
}

export async function cycleDetail(db: Db, id: bigint) {
  const [cycle, positions, experiments] = await Promise.all([
    db.cycle.findUnique({ where: { id } }),
    db.position.findMany({ where: { cycleId: id }, orderBy: { nominalReward: "desc" } }),
    db.experiment.findMany({ where: { cycleId: id }, orderBy: [{ slot: "asc" }, { eventIndex: "asc" }] }),
  ]);
  return cycle ? { cycle, positions, experiments } : null;
}

export const ACTIVITY_EVENTS = [
  "ParticlesDeployed",
  "RewardClaimed",
  "CycleFinalized",
  "CycleOpened",
  "CycleClosed",
  "RandomnessRevealed",
  "CycleVoided",
  "PositionSettled",
];

export async function activity(db: Db, limit: number, afterId?: bigint) {
  const events = await db.indexedEvent.findMany({
    where: { name: { in: ACTIVITY_EVENTS }, ...(afterId != null ? { id: { gt: afterId } } : {}) },
    orderBy: { id: "desc" },
    take: limit,
  });
  return events.map((e) => ({
    id: e.id,
    name: e.name,
    signature: e.signature,
    cycleId: e.cycleId,
    owner: e.owner,
    blockTime: e.blockTime,
    commitment: e.commitment,
    data: e.data,
  }));
}

// ---------------------------------------------------------------- experiments

export interface ExperimentFilter {
  owner?: string;
  cycleId?: bigint;
  barrier?: number;
  status?: string;
  outcome?: "tunneled" | "reflected";
  /** Matches a wallet prefix, transaction signature prefix or experiment id ("cycle-owner-seq"). */
  q?: string;
  page: number;
  pageSize: number;
}

export async function experiments(db: Db, f: ExperimentFilter) {
  const where: NonNullable<Parameters<Db["experiment"]["findMany"]>[0]>["where"] = {};
  if (f.owner) where.owner = f.owner;
  if (f.cycleId != null) where.cycleId = f.cycleId;
  if (f.barrier != null) where.barrier = f.barrier;
  if (f.status) where.status = f.status;
  if (f.outcome === "tunneled") where.successes = { gt: 0 };
  if (f.outcome === "reflected") where.successes = 0;
  if (f.q) {
    const id = /^(\d+)-([1-9A-HJ-NP-Za-km-z]{32,44})-(\d+)$/.exec(f.q);
    if (id) Object.assign(where, { cycleId: BigInt(id[1]), owner: id[2], seq: Number(id[3]) });
    else if (/^\d+$/.test(f.q)) where.cycleId = BigInt(f.q);
    else where.OR = [{ owner: { startsWith: f.q } }, { signature: { startsWith: f.q } }];
  }
  const [rows, total] = await Promise.all([
    db.experiment.findMany({
      where,
      orderBy: [{ slot: "desc" }, { eventIndex: "desc" }],
      skip: f.page * f.pageSize,
      take: f.pageSize,
    }),
    db.experiment.count({ where }),
  ]);
  return { rows, total, page: f.page, pageSize: f.pageSize };
}

export async function experimentDetail(db: Db, cycleId: bigint, owner: string, seq: number) {
  const experiment = await db.experiment.findUnique({ where: { cycleId_owner_seq: { cycleId, owner, seq } } });
  if (!experiment) return null;
  const [cycle, position] = await Promise.all([
    db.cycle.findUnique({ where: { id: cycleId } }),
    db.position.findUnique({ where: { cycleId_owner: { cycleId, owner } } }),
  ]);
  return { experiment, cycle, position };
}

/** Observed tunneling frequency vs the physics model, per barrier × energy level, over every revealed experiment. */
export async function empiricalRates(db: Db) {
  const groups = await db.experiment.groupBy({
    by: ["barrier", "level", "transmissionPpb"],
    where: { successes: { not: null } },
    _sum: { count: true, successes: true },
    _count: { _all: true },
  });
  return groups.map((g) => ({
    barrier: g.barrier,
    level: g.level,
    transmissionPpb: g.transmissionPpb,
    experiments: g._count._all,
    particles: g._sum.count ?? 0,
    successes: g._sum.successes ?? 0,
  }));
}

// ---------------------------------------------------------------- leaderboard

export const LEADER_CATEGORIES = {
  tunnels: { field: "successes", label: "Most successful tunnels" },
  rewards: { field: "tokensEarned", label: "Total rewards earned" },
  particles: { field: "particles", label: "Total particles deployed" },
  best: { field: "bestCycleTokens", label: "Highest single-cycle reward" },
  streak: { field: "longestStreak", label: "Longest success streak" },
  active: { field: "cyclesPlayed", label: "Most active participants" },
} as const;
export type LeaderCategory = keyof typeof LEADER_CATEGORIES;

export async function leaderboard(db: Db, category: LeaderCategory, limit: number, wallet?: string) {
  const field = LEADER_CATEGORIES[category].field;
  const rows = await db.walletStats.findMany({
    where: { [field]: { gt: 0 } },
    orderBy: [{ [field]: "desc" }, { owner: "asc" }],
    take: limit,
  });
  let you: { rank: number; row: (typeof rows)[number] } | null = null;
  if (wallet) {
    const mine = await db.walletStats.findUnique({ where: { owner: wallet } });
    const value = mine?.[field];
    if (mine && value != null && (typeof value === "bigint" ? value > 0n : value > 0)) {
      const ahead = await db.walletStats.count({ where: { OR: [{ [field]: { gt: value } }, { [field]: value, owner: { lt: wallet } }] } });
      you = { rank: ahead + 1, row: mine };
    }
  }
  const total = await db.walletStats.count({ where: { [field]: { gt: 0 } } });
  return { rows: rows.map((r, i) => ({ rank: i + 1, ...r })), total, you };
}

// ---------------------------------------------------------------- profiles

export async function walletProfile(db: Db, owner: string) {
  const [user, stats, positions, recent, claims] = await Promise.all([
    db.user.findUnique({ where: { wallet: owner } }),
    db.walletStats.findUnique({ where: { owner } }),
    db.position.findMany({ where: { owner }, include: { cycle: { select: { status: true, outcome: true, openTs: true } } }, orderBy: { cycleId: "desc" }, take: 500 }),
    db.experiment.findMany({ where: { owner }, orderBy: [{ slot: "desc" }, { eventIndex: "desc" }], take: 100 }),
    db.claim.findMany({ where: { owner }, orderBy: { slot: "desc" }, take: 200 }),
  ]);
  return {
    user,
    stats,
    timeline: positions.map((p) => ({
      cycleId: p.cycleId,
      openTs: p.cycle.openTs,
      status: p.cycle.status,
      outcome: p.cycle.outcome,
      particles: p.particles.reduce((a, b) => a + b, 0),
      successes: p.successes.reduce((a, b) => a + b, 0),
      energyUsed: p.energyUsed,
      experiments: p.experiments,
      settled: p.settled,
      claimed: p.claimed,
      tokens: p.claimed ? p.tokensPaid : p.expectedTokens,
      claimSignature: p.claimSignature,
    })),
    experiments: recent,
    claims,
  };
}

// ---------------------------------------------------------------- administration

export async function adminOverview(db: Db) {
  const stuckBefore = new Date(Date.now() - 5 * 60_000);
  const [state, failed, recentActions, statusCounts, stuck, unclaimed, lastEvent, cursor] = await Promise.all([
    db.protocolState.findUnique({ where: { id: 1 } }),
    db.keeperAction.findMany({ where: { status: "failed" }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.keeperAction.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    db.cycle.groupBy({ by: ["status"], _count: { _all: true } }),
    db.cycle.findMany({ where: { status: { in: ["closed", "awaitingRandomness", "resolving"] }, closeTs: { lt: stuckBefore } }, orderBy: { id: "asc" } }),
    db.position.aggregate({ where: { claimed: false, expectedTokens: { gt: 0 } }, _sum: { expectedTokens: true }, _count: { _all: true } }),
    db.indexedEvent.findFirst({ orderBy: { id: "desc" }, select: { blockTime: true, slot: true, createdAt: true } }),
    db.indexerCursor.findUnique({ where: { id: "program-signatures" } }),
  ]);
  return {
    state,
    failed,
    recentActions,
    statusCounts: statusCounts.map((s) => ({ status: s.status, count: s._count._all })),
    stuck,
    unclaimed: { positions: unclaimed._count._all, tokens: unclaimed._sum.expectedTokens ?? 0n },
    indexer: { lastEvent, cursor, lagMs: state ? Date.now() - state.updatedAt.getTime() : null },
  };
}
