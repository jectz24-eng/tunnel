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
    roundId: e.data.round_id != null ? big(e.data.round_id) : null,
    owner: str(e.data.owner),
    data: normaliseEventData(e.data),
  }));
  const deposits = tx.events
    .filter((e) => e.name === "ParticlesDeployed")
    .map((e) => ({
      signature: tx.signature,
      eventIndex: e.index,
      roundId: big(e.data.round_id),
      owner: str(e.data.owner)!,
      barrier: Number(e.data.barrier),
      count: Number(e.data.count),
      lamports: big(e.data.lamports),
      blockTime: time,
      slot: BigInt(tx.slot),
    }));
  const claims = tx.events
    .filter((e) => e.name === "RewardClaimed")
    .map((e) => ({
      signature: tx.signature,
      eventIndex: e.index,
      roundId: big(e.data.round_id),
      owner: str(e.data.owner)!,
      lamports: big(e.data.lamports),
      tokens: big(e.data.tokens),
      outcome: Number(e.data.outcome),
      blockTime: time,
      slot: BigInt(tx.slot),
    }));
  const roundIds = new Set(indexed.filter((r) => r.roundId != null).map((r) => r.roundId!));
  const owners = new Set(indexed.filter((r) => r.owner != null).map((r) => r.owner!));
  return { indexed, deposits, claims, roundIds, owners };
}

export function decodeTx(programId: PublicKey, signature: string, slot: number, blockTime: number | null, logs: string[]): TxEvents {
  return { signature, slot, blockTime, events: parseEvents(programId, logs) };
}

export async function writeTx(db: PrismaClient, tx: TxEvents) {
  const rows = rowsFromTx(tx);
  if (!rows.indexed.length) return rows;
  await db.$transaction([
    db.indexedEvent.createMany({ data: rows.indexed, skipDuplicates: true }),
    db.deposit.createMany({ data: rows.deposits, skipDuplicates: true }),
    db.claim.createMany({ data: rows.claims, skipDuplicates: true }),
  ]);
  return rows;
}
