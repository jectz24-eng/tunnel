import "server-only";
import { casinoLimits, claimableFor, loadConfig, publicCycle, reserveAvailable } from "@tunnel/core";
import type { getDb } from "@tunnel/db";
import { oddsToJson, paramsToJson } from "@tunnel/sdk";

type Db = ReturnType<typeof getDb>;
type CycleRow = NonNullable<Awaited<ReturnType<Db["cycle"]["findUnique"]>>>;
type PositionRow = NonNullable<Awaited<ReturnType<Db["position"]["findUnique"]>>>;
type ExperimentRow = NonNullable<Awaited<ReturnType<Db["experiment"]["findUnique"]>>>;

const TERMINAL = ["settled", "void"];

/** Public view of a cycle. The server seed is withheld until the cycle is final. */
export function cycleDto(c: CycleRow) {
  return publicCycle(c);
}

export function positionDto(p: PositionRow & { payoutRef?: { status: string; txSignature: string | null } | null }) {
  const { payoutRef, ...rest } = p;
  return { ...rest, owner: p.wallet, payoutStatus: payoutRef?.status ?? null, payoutTx: payoutRef?.txSignature ?? null };
}

/** Experiments are public, but the raw signed message is only useful on the detail page. */
export function experimentDto(e: ExperimentRow) {
  const { message: _m, nonce: _n, ...rest } = e;
  return { ...rest, owner: e.wallet };
}

// ---------------------------------------------------------------- live state

/** Everything the accelerator needs in one poll: config, the open cycle, recent cycles, server time. */
export async function liveState(db: Db, recentCount: number) {
  const cfg = await loadConfig(db);
  const [recent, available, totals] = await Promise.all([
    db.cycle.findMany({ orderBy: { id: "desc" }, take: recentCount }),
    reserveAvailable(db, cfg.reserveFundedTotal),
    protocolTotals(db),
  ]);
  const heartbeatAgeMs = cfg.engineHeartbeat ? Date.now() - cfg.engineHeartbeat.getTime() : null;
  return {
    now: Date.now(),
    config: {
      params: paramsToJson(cfg.params),
      odds: oddsToJson(cfg.odds),
      paused: cfg.paused,
      tunnelMint: cfg.tunnelMint,
      rewardWallet: cfg.rewardWallet,
      reserveFundedTotal: cfg.reserveFundedTotal,
      reserveAvailable: available,
      rewardWalletTokens: cfg.rewardWalletTokens,
      rewardWalletLamports: cfg.rewardWalletLamports,
      lastSlot: cfg.lastSlot,
      engineOnline: heartbeatAgeMs != null && heartbeatAgeMs < 30_000,
      heartbeatAgeMs,
    },
    totals,
    current: recent.find((c) => c.status === "open") ? cycleDto(recent.find((c) => c.status === "open")!) : null,
    recent: recent.map(cycleDto),
  };
}

export async function protocolTotals(db: Db) {
  const [agg, users, claimed] = await Promise.all([
    db.cycle.aggregate({ _sum: { experiments: true, energyUsed: true, tokensAllocated: true }, _count: { _all: true } }),
    db.user.count(),
    db.payout.aggregate({ where: { status: "confirmed" }, _sum: { amount: true } }),
  ]);
  const [parts] = await db.$queryRaw<{ particles: bigint | null; successes: bigint | null }[]>`
    SELECT SUM("particles"[1] + "particles"[2] + "particles"[3])::bigint AS particles,
           SUM(CASE WHEN "status" = 'settled' THEN "successes"[1] + "successes"[2] + "successes"[3] ELSE 0 END)::bigint AS successes
    FROM "Cycle"`;
  return {
    cycles: agg._count._all,
    users,
    experiments: agg._sum.experiments ?? 0,
    particles: parts?.particles ?? 0n,
    successes: parts?.successes ?? 0n,
    energyUsed: agg._sum.energyUsed ?? 0n,
    tokensAllocated: agg._sum.tokensAllocated ?? 0n,
    tokensClaimed: claimed._sum.amount ?? 0n,
  };
}

/** A wallet's live view: its recent positions (with payout state), claimable balance, recent payouts. */
export async function walletState(db: Db, wallet: string) {
  const [positions, claimable, payouts, stats] = await Promise.all([
    db.position.findMany({ where: { wallet }, orderBy: { cycleId: "desc" }, take: 60 }),
    claimableFor(db, wallet),
    db.payout.findMany({ where: { wallet }, orderBy: { id: "desc" }, take: 20, select: { id: true, amount: true, status: true, txSignature: true, createdAt: true, confirmedAt: true, error: true } }),
    db.walletStats.findUnique({ where: { owner: wallet } }),
  ]);
  const byId = new Map(payouts.map((p) => [p.id.toString(), p]));
  return {
    positions: positions.map((p) => positionDto({ ...p, payoutRef: p.payoutId != null ? (byId.get(p.payoutId.toString()) ?? null) : null })),
    claimable,
    payouts,
    stats,
  };
}

// ---------------------------------------------------------------- history

export async function protocolSummary(db: Db) {
  const [cfg, totals, settled] = await Promise.all([
    loadConfig(db),
    protocolTotals(db),
    db.experiment.count({ where: { status: { in: ["settled", "claimed"] } } }),
  ]);
  return { paused: cfg.paused, reserveFundedTotal: cfg.reserveFundedTotal, totals, settledExperiments: settled };
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
  const rows = await db.cycle.findMany({ where: before != null ? { id: { lt: before } } : undefined, orderBy: { id: "desc" }, take: limit });
  return rows.map(cycleDto);
}

export async function cycleDetail(db: Db, id: bigint) {
  const [cycle, positions, experiments] = await Promise.all([
    db.cycle.findUnique({ where: { id } }),
    db.position.findMany({ where: { cycleId: id }, orderBy: [{ nominalReward: "desc" }, { wallet: "asc" }] }),
    db.experiment.findMany({ where: { cycleId: id }, orderBy: { id: "asc" } }),
  ]);
  return cycle ? { cycle: cycleDto(cycle), positions: positions.map((p) => positionDto(p)), experiments: experiments.map(experimentDto) } : null;
}

export const ACTIVITY_EVENTS = ["ParticlesDeployed", "RewardClaimed", "CycleSettled", "CycleOpened", "CycleClosed", "CycleVoided", "ClaimRequested"];

export async function activity(db: Db, limit: number, afterId?: bigint) {
  const events = await db.protocolEvent.findMany({
    where: { name: { in: ACTIVITY_EVENTS }, ...(afterId != null ? { id: { gt: afterId } } : {}) },
    orderBy: { id: "desc" },
    take: limit,
  });
  return events.map((e) => ({ id: e.id, name: e.name, cycleId: e.cycleId, owner: e.wallet, createdAt: e.createdAt, data: e.data }));
}

// ---------------------------------------------------------------- experiments

export interface ExperimentFilter {
  owner?: string;
  cycleId?: bigint;
  barrier?: number;
  status?: string;
  outcome?: "tunneled" | "reflected";
  /** Matches a wallet prefix, signature prefix or experiment id ("cycle-owner-seq"). */
  q?: string;
  page: number;
  pageSize: number;
}

export async function experiments(db: Db, f: ExperimentFilter) {
  const where: NonNullable<Parameters<Db["experiment"]["findMany"]>[0]>["where"] = {};
  if (f.owner) where.wallet = f.owner;
  if (f.cycleId != null) where.cycleId = f.cycleId;
  if (f.barrier != null) where.barrier = f.barrier;
  if (f.status) where.status = f.status;
  if (f.outcome === "tunneled") where.successes = { gt: 0 };
  if (f.outcome === "reflected") where.successes = 0;
  if (f.q) {
    const id = /^(\d+)-([1-9A-HJ-NP-Za-km-z]{32,44})-(\d+)$/.exec(f.q);
    if (id) Object.assign(where, { cycleId: BigInt(id[1]), wallet: id[2], seq: Number(id[3]) });
    else if (/^\d+$/.test(f.q)) where.cycleId = BigInt(f.q);
    else where.OR = [{ wallet: { startsWith: f.q } }, { signature: { startsWith: f.q } }];
  }
  const [rows, total] = await Promise.all([
    db.experiment.findMany({ where, orderBy: { id: "desc" }, skip: f.page * f.pageSize, take: f.pageSize }),
    db.experiment.count({ where }),
  ]);
  return { rows: rows.map(experimentDto), total, page: f.page, pageSize: f.pageSize };
}

export async function experimentDetail(db: Db, cycleId: bigint, owner: string, seq: number) {
  const experiment = await db.experiment.findUnique({ where: { cycleId_wallet_seq: { cycleId, wallet: owner, seq } } });
  if (!experiment) return null;
  const [cycle, position] = await Promise.all([
    db.cycle.findUnique({ where: { id: cycleId } }),
    db.position.findUnique({ where: { cycleId_wallet: { cycleId, wallet: owner } } }),
  ]);
  return {
    experiment: { ...experimentDto(experiment), message: experiment.message },
    cycle: cycle ? cycleDto(cycle) : null,
    position: position ? positionDto(position) : null,
  };
}

/** Observed tunneling frequency vs the physics model, per barrier × energy level, over every settled experiment. */
export async function empiricalRates(db: Db) {
  const groups = await db.experiment.groupBy({
    by: ["barrier", "level", "transmissionPpb"],
    where: { successes: { not: null }, status: { in: ["settled", "claimed"] } },
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
  streak: { field: "longestStreak", label: "Longest participation streak" },
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
  const [user, stats, positions, recent, payouts] = await Promise.all([
    db.user.findUnique({ where: { wallet: owner } }),
    db.walletStats.findUnique({ where: { owner } }),
    db.position.findMany({ where: { wallet: owner }, include: { cycle: { select: { status: true, outcome: true, openTs: true } } }, orderBy: { cycleId: "desc" }, take: 500 }),
    db.experiment.findMany({ where: { wallet: owner }, orderBy: { id: "desc" }, take: 100 }),
    db.payout.findMany({ where: { wallet: owner }, orderBy: { id: "desc" }, take: 200 }),
  ]);
  const payoutById = new Map(payouts.map((p) => [p.id.toString(), p]));
  return {
    user,
    stats,
    timeline: positions.map((p) => {
      const payout = p.payoutId != null ? payoutById.get(p.payoutId.toString()) : undefined;
      return {
        cycleId: p.cycleId,
        openTs: p.cycle.openTs,
        status: p.cycle.status,
        outcome: p.cycle.outcome,
        particles: p.particles.reduce((a, b) => a + b, 0),
        successes: p.successes.reduce((a, b) => a + b, 0),
        energyUsed: p.energyUsed,
        experiments: p.experiments,
        settled: p.settled,
        claimed: payout?.status === "confirmed",
        tokens: p.payout ?? 0n,
        claimSignature: payout?.status === "confirmed" ? payout.txSignature : null,
      };
    }),
    experiments: recent.map(experimentDto),
    claims: payouts
      .filter((p) => p.status === "confirmed")
      .map((p) => ({ id: p.id, amount: p.amount, signature: p.txSignature, confirmedAt: p.confirmedAt })),
  };
}

// ---------------------------------------------------------------- administration

export async function adminOverview(db: Db) {
  const stuckBefore = new Date(Date.now() - 15 * 60_000);
  const [state, failedActions, statusCounts, stuck, unclaimed, payoutQueue, failedPayouts, recentEvents] = await Promise.all([
    liveState(db, 1),
    db.engineAction.findMany({ where: { status: "failed" }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.cycle.groupBy({ by: ["status"], _count: { _all: true } }),
    db.cycle.findMany({ where: { status: "closed", closedAt: { lt: stuckBefore } }, orderBy: { id: "asc" } }),
    db.position.aggregate({ where: { settled: true, payout: { gt: 0 }, payoutId: null }, _sum: { payout: true }, _count: { _all: true } }),
    db.payout.findMany({ where: { status: { in: ["requested", "sending"] } }, orderBy: { id: "asc" }, take: 100 }),
    db.payout.findMany({ where: { status: "failed" }, orderBy: { id: "desc" }, take: 30 }),
    db.protocolEvent.findMany({ where: { name: { in: ["ParamsUpdated", "MiningPaused", "MiningResumed", "ReserveFunded", "CycleVoided", "ClaimFailed", "BetLimitsUpdated", "WithdrawalFailed"] } }, orderBy: { id: "desc" }, take: 30 }),
  ]);
  const [limits, accounts, betAgg] = await Promise.all([
    casinoLimits(db),
    db.account.aggregate({ _sum: { balance: true, wagered: true, returned: true, deposited: true, withdrawn: true }, _count: { _all: true } }),
    db.bet.aggregate({ _count: { _all: true } }),
  ]);
  return {
    casino: {
      bettingOpen: !limits.bettingPaused,
      minBet: limits.minBet,
      maxBet: limits.maxBet,
      maxWinBps: limits.maxWinBps,
      freeBankroll: limits.freeBankroll,
      playerBalances: accounts._sum.balance ?? 0n,
      players: accounts._count._all,
      bets: betAgg._count._all,
      wagered: accounts._sum.wagered ?? 0n,
      returned: accounts._sum.returned ?? 0n,
      deposited: accounts._sum.deposited ?? 0n,
      withdrawn: accounts._sum.withdrawn ?? 0n,
    },
    config: state.config,
    totals: state.totals,
    failedActions,
    statusCounts: statusCounts.map((s) => ({ status: s.status, count: s._count._all })),
    stuck: stuck.map(cycleDto),
    unclaimed: { positions: unclaimed._count._all, tokens: unclaimed._sum.payout ?? 0n },
    payoutQueue,
    failedPayouts,
    recentEvents,
  };
}
