/**
 * Reconciler: makes the database match program accounts. Events tell us
 * *what* changed; this module re-reads the authoritative account state and
 * overwrites derived rows, so the database converges on chain state even if
 * events were missed, duplicated or arrived out of order.
 *
 * It also derives each experiment's particle outcomes from the cycle's
 * revealed randomness (the same computation the program performs) and checks
 * them against the per-cell success counts the program recorded.
 */
import { PublicKey as PK, type Connection, type PublicKey } from "@solana/web3.js";
import type { PrismaClient } from "@tunnel/db";
import {
  BARRIER_COUNT,
  ENERGY_LEVELS,
  computePayout,
  fetchCyclePositions,
  fetchCycles,
  fetchProtocol,
  mulDiv,
  particleOutcomes,
  positionPda,
  toHex,
  type CycleAccount,
  type PositionAccount,
} from "@tunnel/sdk";
import { log } from "./log";

const TERMINAL = new Set(["settled", "void"]);
const zeros = () => Array.from({ length: BARRIER_COUNT }, () => Array(ENERGY_LEVELS).fill(0) as number[]);
const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

export class Reconciler {
  private dirtyCycles = new Set<bigint>();
  private dirtyOwners = new Set<string>();

  constructor(
    private readonly connection: Connection,
    private readonly db: PrismaClient,
    private readonly programId: PublicKey,
    private readonly scanWindow: number,
  ) {}

  touch = (cycleIds: Set<bigint>, owners: Set<string>) => {
    cycleIds.forEach((c) => this.dirtyCycles.add(c));
    owners.forEach((o) => this.dirtyOwners.add(o));
  };

  async run() {
    const slot = BigInt(await this.connection.getSlot("confirmed"));
    const protocol = await fetchProtocol(this.connection, this.programId);
    if (!protocol) return;

    await this.db.protocolState.upsert({
      where: { id: 1 },
      create: { id: 1, ...protocolRow(protocol), slot },
      update: { ...protocolRow(protocol), slot },
    });

    // Cycles to refresh: the recent window, anything not yet final in the DB, and anything events touched.
    const next = protocol.nextCycleId;
    const ids = new Set<bigint>(this.dirtyCycles);
    const touched = new Set<bigint>(this.dirtyCycles);
    for (let i = next - BigInt(this.scanWindow); i < next; i++) if (i >= 0n) ids.add(i);
    const open = await this.db.cycle.findMany({
      where: { OR: [{ status: { notIn: [...TERMINAL] } }, { swept: false, participants: { gt: 0 } }] },
      select: { id: true },
      take: 500,
    });
    open.forEach((c) => ids.add(c.id));
    this.dirtyCycles.clear();

    const sorted = [...ids].sort((a, b) => (a < b ? -1 : 1));
    const cycles = (await fetchCycles(this.connection, sorted, this.programId)).filter((c): c is CycleAccount => !!c);
    const existing = new Map((await this.db.cycle.findMany({ where: { id: { in: cycles.map((c) => c.id) } } })).map((c) => [c.id, c]));

    for (const c of cycles) {
      const prev = existing.get(c.id);
      const changed =
        !prev ||
        prev.status !== c.status ||
        prev.participants !== c.participants ||
        prev.experiments !== c.experiments ||
        prev.claims !== c.claims ||
        prev.swept !== c.swept ||
        prev.totalNominal !== c.totalNominal ||
        touched.has(c.id) ||
        (await this.dbBehindChain(c));
      await this.db.cycle.upsert({
        where: { id: c.id },
        create: { id: c.id, ...cycleRow(c), reconciledSlot: slot },
        update: { ...cycleRow(c), reconciledSlot: slot },
      });
      if (changed && c.participants > 0) {
        const live = await fetchCyclePositions(this.connection, c.id, this.programId);
        // Claimed positions are closed onchain; rebuild them from their permanent events.
        const liveOwners = new Set(live.map((p) => p.owner.toBase58()));
        const closed = (await positionsFromEvents(this.db, c.id, this.programId)).filter((p) => !liveOwners.has(p.owner.toBase58()));
        const claimSigs = new Map(
          (await this.db.claim.findMany({ where: { cycleId: c.id }, select: { owner: true, signature: true } })).map((r) => [r.owner, r.signature]),
        );
        const all = [...live, ...closed];
        for (const p of all) {
          const owner = p.owner.toBase58();
          await this.db.position.upsert({
            where: { cycleId_owner: { cycleId: c.id, owner } },
            create: { cycleId: c.id, owner, ...positionRow(c, p), claimSignature: claimSigs.get(owner) ?? null },
            update: { ...positionRow(c, p), claimSignature: claimSigs.get(owner) ?? null },
          });
          this.dirtyOwners.add(owner);
        }
        await this.reconcileExperiments(c, all);
      }
    }

    if (this.dirtyOwners.size) {
      const owners = [...this.dirtyOwners];
      this.dirtyOwners.clear();
      await this.recomputeWalletStats(owners);
    }
  }

  /** True when stored positions/experiments lag the cycle (e.g. settled or claimed before we last looked). */
  private async dbBehindChain(c: CycleAccount): Promise<boolean> {
    if (c.participants === 0) return false;
    const [rows, settled, claimed, experiments] = await Promise.all([
      this.db.position.count({ where: { cycleId: c.id } }),
      this.db.position.count({ where: { cycleId: c.id, settled: true } }),
      this.db.position.count({ where: { cycleId: c.id, claimed: true } }),
      this.db.experiment.count({ where: { cycleId: c.id, status: TERMINAL.has(c.status) ? { in: ["settled", "void", "claimed"] } : undefined } }),
    ]);
    return rows < c.participants || settled < c.positionsSettled || claimed < c.claims || experiments < c.experiments;
  }

  /**
   * Derives each experiment's outcomes from the cycle randomness and its
   * share of the position payout; checks the per-cell totals against what
   * the program recorded for the position.
   */
  async reconcileExperiments(c: CycleAccount, positions: PositionAccount[]) {
    const rows = await this.db.experiment.findMany({ where: { cycleId: c.id }, orderBy: [{ owner: "asc" }, { seq: "asc" }] });
    const revealed = c.randomness.some((b) => b !== 0);
    const final = TERMINAL.has(c.status);
    const byOwner = new Map(positions.map((p) => [p.owner.toBase58(), p]));
    const derived = new Map<string, number[][]>();

    for (const e of rows) {
      const pos = byOwner.get(e.owner);
      let status = c.status === "void" ? "void" : final ? "settled" : c.status === "open" ? "pending" : "awaiting_randomness";
      if (status === "settled" && pos?.claimed) status = "claimed";
      let successes: number | null = null;
      let outcomeBits: string | null = null;
      let rewardTokens: bigint | null = null;
      if (revealed && c.status !== "void") {
        const outs = particleOutcomes(c.randomness, c.id, new PK(e.owner).toBytes(), e.barrier, e.level, e.count, e.transmissionPpb, e.firstIndex);
        successes = outs.filter((o) => o.success).length;
        outcomeBits = outs.map((o) => (o.success ? "1" : "0")).join("");
        const cells = derived.get(e.owner) ?? zeros();
        cells[e.barrier][e.level] += successes;
        derived.set(e.owner, cells);
        if (final) {
          const nominal = BigInt(successes) * e.nominalReward;
          rewardTokens =
            c.outcome !== "rewards" || nominal === 0n ? 0n : c.totalNominal <= c.emissionBudget ? nominal : mulDiv(c.emissionBudget, nominal, c.totalNominal);
        }
      } else if (c.status === "void") {
        rewardTokens = 0n;
      }
      await this.db.experiment.update({
        where: { cycleId_owner_seq: { cycleId: e.cycleId, owner: e.owner, seq: e.seq } },
        data: { status, successes, outcomeBits, rewardTokens },
      });
    }

    // Cross-check: the experiments we indexed must add up to what the program settled.
    for (const [owner, cells] of derived) {
      const pos = byOwner.get(owner);
      if (!pos?.settled) continue;
      const mismatch = cells.some((row, b) => row.some((s, l) => s !== pos.successes[b][l]));
      if (mismatch) log.warn({ cycleId: String(c.id), owner }, "indexed experiments disagree with settled position (missing events?)");
    }
  }

  /** Aggregates are recomputed from Position rows, never incremented, so they cannot drift. */
  async recomputeWalletStats(owners: string[]) {
    const positions = await this.db.position.findMany({
      where: { owner: { in: owners } },
      include: { cycle: { select: { status: true, outcome: true } } },
      orderBy: { cycleId: "asc" },
    });
    const by = new Map<string, typeof positions>();
    for (const p of positions) by.set(p.owner, [...(by.get(p.owner) ?? []), p]);
    for (const owner of owners) {
      const list = by.get(owner) ?? [];
      let particles = 0n, successes = 0n, settledParticles = 0n, energy = 0n, earned = 0n, claimed = 0n, best = 0n;
      let experiments = 0, claimable = 0, longest = 0, run = 0, prevCycle: bigint | null = null;
      for (const p of list) {
        const n = BigInt(p.particles.reduce((a, b) => a + b, 0));
        const s = BigInt(p.successes.reduce((a, b) => a + b, 0));
        particles += n;
        energy += BigInt(p.energyUsed);
        experiments += p.experiments;
        if (p.settled) {
          settledParticles += n;
          successes += s;
        }
        const final = TERMINAL.has(p.cycle.status);
        const tokens = p.claimed ? p.tokensPaid : final ? (p.expectedTokens ?? 0n) : 0n;
        earned += tokens;
        if (p.claimed) claimed += p.tokensPaid;
        if (tokens > best) best = tokens;
        if (!p.claimed && final) claimable++;
        // Streak: consecutive cycle ids, each with at least one tunnel. Gaps and empty cycles break it.
        if (p.settled) {
          run = s > 0n && prevCycle !== null && p.cycleId === prevCycle + 1n && run > 0 ? run + 1 : s > 0n ? 1 : 0;
          prevCycle = p.cycleId;
          longest = Math.max(longest, run);
        }
      }
      const row = {
        cyclesPlayed: list.length,
        experiments,
        particles,
        successes,
        failures: settledParticles - successes,
        energyUsed: energy,
        tokensEarned: earned,
        tokensClaimed: claimed,
        bestCycleTokens: best,
        longestStreak: longest,
        currentStreak: run,
        claimableCycles: claimable,
      };
      await this.db.walletStats.upsert({ where: { owner }, create: { owner, ...row }, update: row });
    }
    log.debug({ owners: owners.length }, "wallet stats recomputed");
  }
}

/**
 * Reconstructs positions from indexed events — used for positions whose
 * account was closed by `claim` (and so can no longer be read from chain).
 */
export async function positionsFromEvents(db: PrismaClient, cycleId: bigint, programId: PublicKey): Promise<PositionAccount[]> {
  const events = await db.indexedEvent.findMany({
    where: { cycleId, name: { in: ["ParticlesDeployed", "PositionSettled", "RewardClaimed"] } },
    orderBy: { id: "asc" },
  });
  const by = new Map<string, PositionAccount>();
  for (const e of events) {
    if (!e.owner) continue;
    const d = e.data as Record<string, any>;
    const p =
      by.get(e.owner) ??
      ({
        address: positionPda(cycleId, new PK(e.owner), programId),
        owner: new PK(e.owner),
        cycleId,
        particles: zeros(),
        energyUsed: 0,
        experiments: 0,
        settled: false,
        successes: zeros(),
        nominalReward: 0n,
        claimed: false,
        tokensPaid: 0n,
      } satisfies PositionAccount);
    if (e.name === "ParticlesDeployed") {
      p.particles[Number(d.barrier)][Number(d.level)] += Number(d.count);
      p.energyUsed = Number(d.energy_used);
      p.experiments = Math.max(p.experiments, Number(d.experiment) + 1);
    } else if (e.name === "PositionSettled") {
      p.particles = (d.particles as (string | number)[][]).map((r) => r.map(Number));
      p.successes = (d.successes as (string | number)[][]).map((r) => r.map(Number));
      p.nominalReward = BigInt(d.nominal_reward);
      p.settled = true;
    } else if (e.name === "RewardClaimed") {
      p.claimed = true;
      p.tokensPaid = BigInt(d.tokens);
    }
    by.set(e.owner, p);
  }
  return [...by.values()];
}

function protocolRow(p: NonNullable<Awaited<ReturnType<typeof fetchProtocol>>>) {
  return {
    address: p.address.toBase58(),
    admin: p.admin.toBase58(),
    gatekeeper: p.gatekeeper.toBase58(),
    tunnelMint: p.tunnelMint.toBase58(),
    rewardVault: p.rewardVault.toBase58(),
    paused: p.paused,
    params: json(p.params),
    odds: json(p.odds),
    nextCycleId: p.nextCycleId,
    reserveAvailable: p.reserveAvailable,
    reserveFundedTotal: p.reserveFundedTotal,
    totalExperiments: p.totalExperiments,
    totalParticles: p.totalParticles,
    totalEnergy: p.totalEnergy,
    totalSuccesses: p.totalSuccesses,
    totalTokensAllocated: p.totalTokensAllocated,
    totalTokensClaimed: p.totalTokensClaimed,
    cyclesSettled: p.cyclesSettled,
  };
}

export function cycleRow(c: CycleAccount) {
  const hasRandomness = c.randomness.some((b) => b !== 0);
  const hasSeed = c.vrfSeed.some((b) => b !== 0);
  return {
    address: c.address.toBase58(),
    status: c.status,
    outcome: c.outcome,
    openTs: new Date(c.openTs * 1000),
    closeTs: new Date(c.closeTs * 1000),
    energyPerCycle: c.energyPerCycle,
    barriers: json(c.barriers),
    levels: json(c.levels),
    odds: json(c.odds),
    emissionBudget: c.emissionBudget,
    participants: c.participants,
    experiments: c.experiments,
    particles: c.particles,
    energyUsed: c.energyUsed,
    vrfSeed: hasSeed ? toHex(c.vrfSeed) : null,
    randomness: hasRandomness ? toHex(c.randomness) : null,
    successes: c.successes,
    totalNominal: c.totalNominal,
    tokensAllocated: c.tokensAllocated,
    claims: c.claims,
    tokensClaimed: c.tokensClaimed,
    settledAt: c.settledTs ? new Date(c.settledTs * 1000) : null,
    swept: c.swept,
  };
}

export function positionRow(c: CycleAccount, p: PositionAccount) {
  const final = TERMINAL.has(c.status) && (p.settled || c.status === "void");
  const expected = final
    ? computePayout({ outcome: c.outcome, totalNominal: c.totalNominal, emissionBudget: c.emissionBudget, positionNominal: p.nominalReward })
    : null;
  return {
    address: p.address.toBase58(),
    particles: p.particles.flat(),
    successes: p.successes.flat(),
    energyUsed: p.energyUsed,
    experiments: p.experiments,
    settled: p.settled,
    nominalReward: p.nominalReward,
    claimed: p.claimed,
    tokensPaid: p.tokensPaid,
    expectedTokens: expected,
  };
}
