/**
 * Event ingestion. Pure mapping from decoded program events to database rows,
 * plus an idempotent writer: every row is keyed by (signature, eventIndex) and
 * inserted with skipDuplicates, so replays, overlapping backfills, websocket
 * duplicates and restarts can never double-count.
 */
import type { PrismaClient } from "@tunnel/db";
import { normaliseEventData, parseEvents, type ParsedEvent } from "@tunnel/sdk";
import type { PublicKey } from "@solana/web3.js";

export interface TxEvents {
  signature: string;
  slot: number;
  blockTime: number | null;
  events: ParsedEvent[];
}

const big = (v: unknown) => BigInt(String(v));
const str = (v: unknown) => (v == null ? null : typeof (v as any).toBase58 === "function" ? (v as any).toBase58() : String(v));

export function rowsFromTx(tx: TxEvents) {
  const time = tx.blockTime != null ? new Date(tx.blockTime * 1000) : null;
  const indexed = tx.events.map((e) => ({
    signature: tx.signature,
    eventIndex: e.index,
    slot: BigInt(tx.slot),
    blockTime: time,
    name: e.name,
    cycleId: e.data.cycle_id != null ? big(e.data.cycle_id) : null,
    owner: str(e.data.owner),
    data: normaliseEventData(e.data),
  }));
  const experiments = tx.events
    .filter((e) => e.name === "ParticlesDeployed")
    .map((e) => ({
      cycleId: big(e.data.cycle_id),
      owner: str(e.data.owner)!,
      seq: Number(e.data.experiment),
      signature: tx.signature,
      eventIndex: e.index,
      slot: BigInt(tx.slot),
      blockTime: time,
      barrier: Number(e.data.barrier),
      level: Number(e.data.level),
      count: Number(e.data.count),
      firstIndex: Number(e.data.first_index),
      energyCost: Number(e.data.energy_cost),
      heightMilli: Number(e.data.height_milli),
      widthMilli: Number(e.data.width_milli),
      energyBps: Number(e.data.energy_bps),
      transmissionPpb: Number(e.data.transmission_ppb),
      nominalReward: big(e.data.nominal_reward),
    }));
  const claims = tx.events
    .filter((e) => e.name === "RewardClaimed")
    .map((e) => ({
      signature: tx.signature,
      eventIndex: e.index,
      cycleId: big(e.data.cycle_id),
      owner: str(e.data.owner)!,
      tokens: big(e.data.tokens),
      outcome: Number(e.data.outcome),
      blockTime: time,
      slot: BigInt(tx.slot),
    }));
  const cycleIds = new Set(indexed.filter((r) => r.cycleId != null).map((r) => r.cycleId!));
  // Only wallets acting as participants (not admins or funders) become users.
  const owners = new Set(
    tx.events.filter((e) => ["ParticlesDeployed", "RewardClaimed", "PositionSettled"].includes(e.name)).map((e) => str(e.data.owner)!),
  );
  return { indexed, experiments, claims, cycleIds, owners, time };
}

export function decodeTx(programId: PublicKey, signature: string, slot: number, blockTime: number | null, logs: string[]): TxEvents {
  return { signature, slot, blockTime, events: parseEvents(programId, logs) };
}

export async function writeTx(db: PrismaClient, tx: TxEvents) {
  const rows = rowsFromTx(tx);
  if (!rows.indexed.length) return rows;
  const seen = rows.time ?? new Date();
  await db.$transaction([
    db.indexedEvent.createMany({ data: rows.indexed, skipDuplicates: true }),
    db.experiment.createMany({ data: rows.experiments, skipDuplicates: true }),
    db.claim.createMany({ data: rows.claims, skipDuplicates: true }),
    db.user.createMany({ data: [...rows.owners].map((wallet) => ({ wallet, firstSeenAt: seen, lastActivityAt: seen })), skipDuplicates: true }),
    db.user.updateMany({ where: { wallet: { in: [...rows.owners] }, lastActivityAt: { lt: seen } }, data: { lastActivityAt: seen } }),
  ]);
  return rows;
}
