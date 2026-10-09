/**
 * Reconciler: makes the database match program accounts. Events tell us
 * *what* changed; this module re-reads the authoritative account state and
 * overwrites derived rows, so the database converges on chain state even if
 * events were missed, duplicated or arrived out of order.
 */
import { PublicKey as PK, type Connection, type PublicKey } from "@solana/web3.js";
import type { PrismaClient } from "@tunnel/db";
import {
  computePayout,
  fetchProtocol,
  fetchRoundPositions,
  fetchRounds,
  positionPda,
  toHex,
  type PositionAccount,
  type RoundAccount,
} from "@tunnel/sdk";
import { log } from "./log";

const TERMINAL = new Set(["settled", "failed"]);

export class Reconciler {
  private dirtyRounds = new Set<bigint>();
  private dirtyOwners = new Set<string>();

  constructor(
    private readonly connection: Connection,
    private readonly db: PrismaClient,
    private readonly programId: PublicKey,
    private readonly scanWindow: number,
  ) {}

  touch = (roundIds: Set<bigint>, owners: Set<string>) => {
    roundIds.forEach((r) => this.dirtyRounds.add(r));
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

    // Rounds to refresh: the recent window, anything not yet final in the DB, and anything events touched.
    const next = protocol.nextRoundId;
    const ids = new Set<bigint>(this.dirtyRounds);
    const touched = new Set<bigint>(this.dirtyRounds);
    for (let i = next - BigInt(this.scanWindow); i < next; i++) if (i >= 0n) ids.add(i);
    const open = await this.db.round.findMany({
      where: { OR: [{ status: { notIn: [...TERMINAL] } }, { swept: false, participants: { gt: 0 } }] },
      select: { id: true },
      take: 500,
    });
    open.forEach((r) => ids.add(r.id));
    this.dirtyRounds.clear();

    const sorted = [...ids].sort((a, b) => (a < b ? -1 : 1));
    const rounds = (await fetchRounds(this.connection, sorted, this.programId)).filter((r): r is RoundAccount => !!r);
    const existing = new Map(
      (await this.db.round.findMany({ where: { id: { in: rounds.map((r) => r.id) } } })).map((r) => [r.id, r]),
    );

    for (const r of rounds) {
      const prev = existing.get(r.id);
      const changed =
        !prev ||
        prev.status !== r.status ||
        prev.participants !== r.participants ||
        prev.claims !== r.claims ||
        prev.totalLamports !== r.totalLamports ||
        prev.swept !== r.swept ||
        prev.totalSuccessWeight !== r.totalSuccessWeight ||
        touched.has(r.id) ||
        (await this.dbBehindChain(r));
      await this.db.round.upsert({
        where: { id: r.id },
        create: { id: r.id, ...roundRow(r), reconciledSlot: slot },
        update: { ...roundRow(r), reconciledSlot: slot },
      });
      if (changed && r.participants > 0) {
        const live = await fetchRoundPositions(this.connection, r.id, this.programId);
        // Claimed positions are closed onchain; rebuild them from their permanent events.
        const liveOwners = new Set(live.map((p) => p.owner.toBase58()));
        const closed = (await positionsFromEvents(this.db, r.id, this.programId)).filter((p) => !liveOwners.has(p.owner.toBase58()));
        for (const p of [...live, ...closed]) {
          await this.db.position.upsert({
            where: { roundId_owner: { roundId: r.id, owner: p.owner.toBase58() } },
            create: { roundId: r.id, owner: p.owner.toBase58(), ...positionRow(r, p) },
            update: positionRow(r, p),
          });
          this.dirtyOwners.add(p.owner.toBase58());
        }
      }
    }

    if (this.dirtyOwners.size) {
      const owners = [...this.dirtyOwners];
      this.dirtyOwners.clear();
      await this.recomputeWalletStats(owners);
    }
  }

  /** True when stored positions lag the round (e.g. settled or claimed before we last looked). */
  private async dbBehindChain(r: RoundAccount): Promise<boolean> {
    if (r.participants === 0) return false;
    const [rows, settled, claimed] = await Promise.all([
      this.db.position.count({ where: { roundId: r.id } }),
      this.db.position.count({ where: { roundId: r.id, settled: true } }),
      this.db.position.count({ where: { roundId: r.id, claimed: true } }),
    ]);
    return rows < r.participants || settled < r.positionsSettled || claimed < r.claims;
  }

  /** Aggregates are recomputed from Position rows, never incremented, so they cannot drift. */
  async recomputeWalletStats(owners: string[]) {
    const positions = await this.db.position.findMany({ where: { owner: { in: owners } }, include: { round: true } });
    const by = new Map<string, typeof positions>();
    for (const p of positions) by.set(p.owner, [...(by.get(p.owner) ?? []), p]);
    for (const owner of owners) {
      const list = by.get(owner) ?? [];
      let particles = 0n, successes = 0n, settledParticles = 0n, committed = 0n, received = 0n, tokens = 0n, claimable = 0;
      for (const p of list) {
        const n = BigInt(p.particles.reduce((a, b) => a + b, 0));
        particles += n;
        committed += p.lamports;
        if (p.settled) {
          settledParticles += n;
          successes += BigInt(p.successes.reduce((a, b) => a + b, 0));
        }
        if (p.claimed) received += p.lamportsPaid;
        tokens += p.claimed ? p.tokensPaid : (p.expectedTokens ?? 0n);
        if (!p.claimed && TERMINAL.has(p.round.status) && p.round.outcome !== "empty") claimable++;
      }
      const row = {
        roundsPlayed: list.length,
        particles,
        successes,
        failures: settledParticles - successes,
        lamportsCommitted: committed,
        lamportsReceived: received,
        tokensMined: tokens,
        claimableRounds: claimable,
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
export async function positionsFromEvents(db: PrismaClient, roundId: bigint, programId: PublicKey): Promise<PositionAccount[]> {
  const events = await db.indexedEvent.findMany({
    where: { roundId, name: { in: ["ParticlesDeployed", "PositionSettled", "RewardClaimed"] } },
    orderBy: { id: "asc" },
  });
  const by = new Map<string, PositionAccount>();
  for (const e of events) {
    if (!e.owner) continue;
    const d = e.data as Record<string, any>;
    const p =
      by.get(e.owner) ??
      ({
        address: positionPda(roundId, new PK(e.owner), programId),
        owner: new PK(e.owner),
        roundId,
        particles: [0, 0, 0],
        lamports: 0n,
        settled: false,
        successes: [0, 0, 0],
        successWeight: 0n,
        claimed: false,
        lamportsPaid: 0n,
        tokensPaid: 0n,
      } satisfies PositionAccount);
    if (e.name === "ParticlesDeployed") {
      p.particles = (d.position_particles as (string | number)[]).map(Number);
      p.lamports += BigInt(d.lamports);
    } else if (e.name === "PositionSettled") {
      p.particles = (d.particles as (string | number)[]).map(Number);
      p.successes = (d.successes as (string | number)[]).map(Number);
      p.successWeight = BigInt(d.success_weight);
      p.settled = true;
    } else if (e.name === "RewardClaimed") {
      p.claimed = true;
      p.lamportsPaid = BigInt(d.lamports);
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
    treasury: p.treasury.toBase58(),
    tunnelMint: p.tunnelMint.toBase58(),
    rewardVault: p.rewardVault.toBase58(),
    paused: p.paused,
    params: JSON.parse(JSON.stringify(p.params, (_, v) => (typeof v === "bigint" ? v.toString() : v))),
    nextRoundId: p.nextRoundId,
    reserveAvailable: p.reserveAvailable,
    reserveFundedTotal: p.reserveFundedTotal,
    totalLamportsCommitted: p.totalLamportsCommitted,
    totalParticles: p.totalParticles,
    totalSuccesses: p.totalSuccesses,
    totalTokensAllocated: p.totalTokensAllocated,
    totalFeesLamports: p.totalFeesLamports,
    roundsSettled: p.roundsSettled,
  };
}

export function roundRow(r: RoundAccount) {
  const hasRandomness = r.randomness.some((b) => b !== 0);
  const hasSeed = r.vrfSeed.some((b) => b !== 0);
  return {
    status: r.status,
    outcome: r.outcome,
    openTs: new Date(r.openTs * 1000),
    closeTs: new Date(r.closeTs * 1000),
    barrierBps: r.barriers.map((b) => b.transmissionBps),
    barrierWeights: r.barriers.map((b) => b.rewardWeight),
    particleCostLamports: r.particleCostLamports,
    protocolFeeBps: r.protocolFeeBps,
    emissionBudget: r.emissionBudget,
    particles: r.particles,
    totalLamports: r.totalLamports,
    participants: r.participants,
    vrfSeed: hasSeed ? toHex(r.vrfSeed) : null,
    randomness: hasRandomness ? toHex(r.randomness) : null,
    successes: r.successes,
    totalSuccessWeight: r.totalSuccessWeight,
    feeLamports: r.feeLamports,
    distributableLamports: r.distributableLamports,
    tokensAllocated: r.outcome === "rewards" ? r.emissionBudget : 0n,
    claims: r.claims,
    settledAt: r.settledTs ? new Date(r.settledTs * 1000) : null,
    swept: r.swept,
  };
}

export function positionRow(r: RoundAccount, p: PositionAccount) {
  const payout =
    TERMINAL.has(r.status) && (p.settled || r.status === "failed")
      ? computePayout({
          outcome: r.outcome,
          distributableLamports: r.distributableLamports,
          totalLamports: r.totalLamports,
          totalSuccessWeight: r.totalSuccessWeight,
          emissionBudget: r.emissionBudget,
          positionLamports: p.lamports,
          positionSuccessWeight: p.successWeight,
        })
      : null;
  return {
    address: p.address.toBase58(),
    particles: p.particles,
    lamports: p.lamports,
    settled: p.settled,
    successes: p.successes,
    successWeight: p.successWeight,
    claimed: p.claimed,
    lamportsPaid: p.lamportsPaid,
    tokensPaid: p.tokensPaid,
    expectedLamports: payout?.lamports ?? null,
    expectedTokens: payout?.tokens ?? null,
  };
}
