/**
 * Cycle lifecycle — open → closed → settled | void. Only the engine calls
 * these. Every transition is a single conditional UPDATE (or a transaction
 * holding the cycle row lock), so concurrent engines or retries are safe.
 */
import {
  BARRIER_COUNT,
  ENERGY_LEVELS,
  commitSeed,
  computePayout,
  decodeBase58,
  deriveRandomness,
  oddsFromJson,
  oddsToJson,
  particleOutcomes,
  scheduledEmission,
  toHex,
  type OddsTableJson,
  type Outcome,
} from "@tunnel/sdk";
import { randomBytes } from "node:crypto";
import { loadConfig, type Db, type Tx } from "./config";

/** Approximate Solana slot time used to place the entropy slot after close. */
export const SLOT_MS = 400;
/** Extra slots beyond the estimated close slot, so the entropy block cannot exist while deployments are open. */
export const ENTROPY_MARGIN_SLOTS = 75n;
/** Close the window early if the chain is within this many slots of the entropy slot. */
export const ENTROPY_GUARD_SLOTS = 30n;

/**
 * $TUNNEL that can still be promised to new cycles: everything funded, minus
 * what settled cycles allocated (paid or owed), minus the budgets reserved by
 * cycles that have not settled yet.
 */
export async function reserveAvailable(db: Tx, fundedTotal: bigint): Promise<bigint> {
  const [row] = await db.$queryRaw<{ allocated: bigint | null; reserved: bigint | null }[]>`
    SELECT
      COALESCE(SUM(CASE WHEN "status" = 'settled' THEN "tokensAllocated" ELSE 0 END), 0)::bigint AS allocated,
      COALESCE(SUM(CASE WHEN "status" IN ('open', 'closed') THEN "emissionBudget" ELSE 0 END), 0)::bigint AS reserved
    FROM "Cycle"`;
  const left = fundedTotal - BigInt(row?.allocated ?? 0n) - BigInt(row?.reserved ?? 0n);
  return left > 0n ? left : 0n;
}

export type OpenResult = { opened: true; id: bigint } | { opened: false; reason: "paused" | "already_open" | "reserve_exhausted" };

/** Opens the next cycle if none is open and mining is not paused. */
export async function openCycle(db: Db, now: Date, currentSlot: bigint): Promise<OpenResult> {
  return db.$transaction(async (tx) => {
    // Serialise openers on the config row.
    await tx.$executeRaw`SELECT 1 FROM "ProtocolConfig" WHERE "id" = 1 FOR UPDATE`;
    const cfg = await loadConfig(tx);
    if (cfg.paused) return { opened: false, reason: "paused" } as const;
    if (await tx.cycle.findFirst({ where: { status: "open" }, select: { id: true } })) return { opened: false, reason: "already_open" } as const;

    const last = await tx.cycle.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
    const id = (last?.id ?? 0n) + 1n;
    const scheduled = scheduledEmission(cfg.params, id);
    const available = await reserveAvailable(tx, cfg.reserveFundedTotal);
    const budget = scheduled < available ? scheduled : available;
    if (budget <= 0n) return { opened: false, reason: "reserve_exhausted" } as const;

    const durationMs = cfg.params.cycleDurationSecs * 1000;
    const closeTs = new Date(now.getTime() + durationMs);
    const entropySlot = currentSlot + BigInt(Math.ceil(durationMs / SLOT_MS)) + ENTROPY_MARGIN_SLOTS;
    const seed = randomBytes(32);
    await tx.cycle.create({
      data: {
        id,
        status: "open",
        openTs: now,
        closeTs,
        energyPerCycle: cfg.params.energyPerCycle,
        barriers: cfg.params.barriers as object,
        levels: cfg.params.levels as object,
        odds: oddsToJson(cfg.odds) as object,
        emissionBudget: budget,
        seedCommitment: commitSeed(seed),
        serverSeed: toHex(seed),
        entropySlot,
      },
    });
    await tx.protocolEvent.create({
      data: { name: "CycleOpened", cycleId: id, data: { closeTs: closeTs.toISOString(), emissionBudget: budget.toString(), seedCommitment: commitSeed(seed), entropySlot: entropySlot.toString() } },
    });
    return { opened: true, id } as const;
  });
}

/**
 * Closes the open cycle once its window has ended — or early, if the chain
 * is about to produce the entropy slot (slots ran faster than estimated).
 */
export async function closeDueCycles(db: Db, now: Date, currentSlot: bigint): Promise<bigint[]> {
  const closed = await db.$queryRaw<{ id: bigint }[]>`
    UPDATE "Cycle" SET "status" = 'closed', "closedAt" = ${now}, "updatedAt" = ${now}
    WHERE "status" = 'open' AND ("closeTs" <= ${now} OR "entropySlot" - ${ENTROPY_GUARD_SLOTS} <= ${currentSlot})
    RETURNING "id"`;
  for (const { id } of closed) {
    await db.protocolEvent.create({ data: { name: "CycleClosed", cycleId: id, data: { closedAt: now.toISOString(), slot: currentSlot.toString() } } });
  }
  return closed.map((c) => c.id);
}

type CycleRow = { id: bigint; status: string; serverSeed: string; emissionBudget: bigint; odds: unknown };

/**
 * Settles a closed cycle with the blockhash of the first produced slot ≥ its
 * entropy slot: derives the randomness, resolves every particle, computes
 * payouts, reveals the seed. Idempotent: a cycle that is not `closed` is skipped.
 */
export async function settleCycle(db: Db, cycleId: bigint, entropy: { slot: bigint; blockhash: string }, now = new Date()) {
  const result = await db.$transaction(
    async (tx) => {
      const [cycle] = await tx.$queryRaw<CycleRow[]>`
        SELECT "id", "status", "serverSeed", "emissionBudget", "odds" FROM "Cycle" WHERE "id" = ${cycleId} FOR UPDATE`;
      if (!cycle || cycle.status !== "closed") return null;

      const odds = oddsFromJson(cycle.odds as OddsTableJson);
      const randomness = deriveRandomness(Buffer.from(cycle.serverSeed, "hex"), entropy.blockhash, cycle.id);
      const positions = await tx.position.findMany({ where: { cycleId } });
      const experiments = await tx.experiment.findMany({ where: { cycleId }, orderBy: { id: "asc" } });

      // Resolve every particle once per [wallet][barrier][level] cell.
      const outcomes = new Map<string, boolean[]>();
      const cellTotals = Array(BARRIER_COUNT).fill(0n) as bigint[];
      let totalNominal = 0n;
      const settledPositions = positions.map((p) => {
        const owner = decodeBase58(p.wallet);
        const successes = Array(BARRIER_COUNT * ENERGY_LEVELS).fill(0) as number[];
        let nominal = 0n;
        for (let b = 0; b < BARRIER_COUNT; b++) {
          for (let l = 0; l < ENERGY_LEVELS; l++) {
            const n = p.particles[b * 5 + l];
            if (!n) continue;
            const hits = particleOutcomes(randomness, cycleId, owner, b, l, n, odds.transmissionPpb[b][l]).map((o) => o.success);
            outcomes.set(`${p.wallet}:${b}:${l}`, hits);
            const s = hits.filter(Boolean).length;
            successes[b * 5 + l] = s;
            cellTotals[b] += BigInt(s);
            nominal += BigInt(s) * odds.reward[b][l];
          }
        }
        totalNominal += nominal;
        return { wallet: p.wallet, successes, nominal };
      });

      const outcome: Outcome = positions.length === 0 ? "empty" : totalNominal === 0n ? "noTunnels" : "rewards";
      let allocated = 0n;
      for (const p of settledPositions) {
        const payout = computePayout({ outcome, totalNominal, emissionBudget: cycle.emissionBudget, positionNominal: p.nominal });
        allocated += payout;
        await tx.position.update({
          where: { cycleId_wallet: { cycleId, wallet: p.wallet } },
          data: { settled: true, successes: p.successes, nominalReward: p.nominal, payout },
        });
      }

      for (const e of experiments) {
        const hits = (outcomes.get(`${e.wallet}:${e.barrier}:${e.level}`) ?? []).slice(e.firstIndex, e.firstIndex + e.count);
        const s = hits.filter(Boolean).length;
        const nominal = BigInt(s) * e.nominalReward;
        await tx.experiment.update({
          where: { id: e.id },
          data: {
            status: "settled",
            successes: s,
            outcomeBits: hits.map((h) => (h ? "1" : "0")).join(""),
            rewardTokens: computePayout({ outcome, totalNominal, emissionBudget: cycle.emissionBudget, positionNominal: nominal }),
          },
        });
      }

      await tx.cycle.update({
        where: { id: cycleId },
        data: {
          status: "settled",
          outcome,
          settledAt: now,
          entropySlotUsed: entropy.slot,
          entropyBlockhash: entropy.blockhash,
          randomness: toHex(randomness),
          successes: cellTotals,
          totalNominal,
          tokensAllocated: allocated,
        },
      });
      await tx.protocolEvent.create({
        data: {
          name: "CycleSettled",
          cycleId,
          data: {
            outcome,
            participants: positions.length,
            successes: cellTotals.map(String),
            totalNominal: totalNominal.toString(),
            tokensAllocated: allocated.toString(),
            serverSeed: cycle.serverSeed,
            entropySlot: entropy.slot.toString(),
            entropyBlockhash: entropy.blockhash,
          },
        },
      });
      return { cycleId, outcome, allocated, wallets: positions.map((p) => p.wallet) };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  return result;
}

/**
 * Voids a closed cycle that could not be settled (e.g. the entropy block was
 * unavailable for too long). Nothing is paid; the budget returns to the
 * reserve. The seed is still revealed.
 */
export async function voidCycle(db: Db, cycleId: bigint, reason: string, now = new Date()) {
  return db.$transaction(async (tx) => {
    const [cycle] = await tx.$queryRaw<{ status: string; serverSeed: string }[]>`
      SELECT "status", "serverSeed" FROM "Cycle" WHERE "id" = ${cycleId} FOR UPDATE`;
    if (!cycle || (cycle.status !== "closed" && cycle.status !== "open")) return false;
    await tx.cycle.update({ where: { id: cycleId }, data: { status: "void", outcome: "void", settledAt: now, closedAt: now } });
    await tx.position.updateMany({ where: { cycleId }, data: { settled: true, payout: 0n } });
    await tx.experiment.updateMany({ where: { cycleId }, data: { status: "void", successes: 0, rewardTokens: 0n } });
    await tx.protocolEvent.create({ data: { name: "CycleVoided", cycleId, data: { reason, serverSeed: cycle.serverSeed } } });
    return true;
  });
}

/** The seed is secret until the cycle is final; everything else about a cycle is public. */
export function publicCycle<T extends { status: string; serverSeed: string }>(c: T): Omit<T, "serverSeed"> & { serverSeed: string | null } {
  return { ...c, serverSeed: c.status === "settled" || c.status === "void" ? c.serverSeed : null };
}
