/**
 * Indexer: a websocket log subscription for low latency plus a cursor-based
 * signature backfill for completeness. Either path alone is sufficient; both
 * write through the same idempotent `writeTx`. After a restart or RPC outage
 * the backfill resumes from the stored cursor, so no event is ever skipped.
 */
import type { Connection, PublicKey } from "@solana/web3.js";
import type { PrismaClient } from "@tunnel/db";
import { decodeTx, writeTx } from "./ingest";
import { log } from "./log";
import { withRetry } from "./retry";

const CURSOR_ID = "program-signatures";

export type TouchFn = (roundIds: Set<bigint>, owners: Set<string>) => void;

export class Indexer {
  private subscription: number | null = null;

  constructor(
    private readonly connection: Connection,
    private readonly db: PrismaClient,
    private readonly programId: PublicKey,
    private readonly touch: TouchFn,
  ) {}

  startLive() {
    this.subscription = this.connection.onLogs(
      this.programId,
      async (l, ctx) => {
        if (l.err) return; // failed transactions emit no state changes
        try {
          const blockTime = await this.connection.getBlockTime(ctx.slot).catch(() => null);
          const rows = await writeTx(this.db, decodeTx(this.programId, l.signature, ctx.slot, blockTime, l.logs));
          if (rows.indexed.length) {
            log.debug({ sig: l.signature, events: rows.indexed.map((r) => r.name) }, "live events");
            this.touch(rows.roundIds, rows.owners);
          }
        } catch (e) {
          // The backfill will pick this signature up; nothing is lost.
          log.warn({ err: String(e), sig: l.signature }, "live ingest failed; deferring to backfill");
        }
      },
      "confirmed",
    );
    log.info("live log subscription started");
  }

  async stopLive() {
    if (this.subscription != null) await this.connection.removeOnLogsListener(this.subscription);
  }

  /** Fetches every program signature newer than the cursor and ingests oldest-first. */
  async backfill(): Promise<number> {
    const cursor = await this.db.indexerCursor.findUnique({ where: { id: CURSOR_ID } });
    const until = cursor?.lastSignature ?? undefined;
    const pending: { signature: string; slot: number; err: unknown }[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await withRetry(() =>
        this.connection.getSignaturesForAddress(this.programId, { until, before, limit: 1000 }, "confirmed"),
      );
      pending.push(...page);
      if (page.length < 1000) break;
      before = page[page.length - 1].signature;
    }
    pending.reverse();
    let processed = 0;
    for (const s of pending) {
      if (!s.err) {
        const tx = await withRetry(() =>
          this.connection.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }),
        );
        if (tx?.meta?.logMessages && !tx.meta.err) {
          const rows = await writeTx(this.db, decodeTx(this.programId, s.signature, tx.slot, tx.blockTime ?? null, tx.meta.logMessages));
          if (rows.indexed.length) this.touch(rows.roundIds, rows.owners);
        }
      }
      await this.db.indexerCursor.upsert({
        where: { id: CURSOR_ID },
        create: { id: CURSOR_ID, lastSignature: s.signature, lastSlot: BigInt(s.slot) },
        update: { lastSignature: s.signature, lastSlot: BigInt(s.slot) },
      });
      processed++;
    }
    if (processed) log.info({ processed }, "backfill ingested signatures");
    return processed;
  }

  /**
   * Finality: promote events at or below the finalized slot. Events that are
   * still unfinalized after two minutes and whose signature the cluster no
   * longer knows (dropped fork) are deleted along with their derived rows.
   */
  async reconcileFinality() {
    const finalizedSlot = BigInt(await this.connection.getSlot("finalized"));
    await this.db.indexedEvent.updateMany({
      where: { commitment: "confirmed", slot: { lte: finalizedSlot } },
      data: { commitment: "finalized" },
    });
    const stale = await this.db.indexedEvent.findMany({
      where: { commitment: "confirmed", createdAt: { lt: new Date(Date.now() - 120_000) } },
      select: { signature: true },
      distinct: ["signature"],
      take: 200,
    });
    if (!stale.length) return;
    const statuses = await this.connection.getSignatureStatuses(stale.map((s) => s.signature), { searchTransactionHistory: true });
    const dropped = stale.filter((_, i) => statuses.value[i] == null || statuses.value[i]?.err).map((s) => s.signature);
    if (dropped.length) {
      await this.db.$transaction([
        this.db.indexedEvent.deleteMany({ where: { signature: { in: dropped } } }),
        this.db.deposit.deleteMany({ where: { signature: { in: dropped } } }),
        this.db.claim.deleteMany({ where: { signature: { in: dropped } } }),
      ]);
      log.warn({ dropped }, "removed events from dropped transactions");
    }
  }

  /** Fills block times that were unavailable when an event was first seen live. */
  async fillBlockTimes() {
    const rows = await this.db.indexedEvent.findMany({ where: { blockTime: null }, select: { slot: true }, distinct: ["slot"], take: 50 });
    for (const { slot } of rows) {
      const t = await this.connection.getBlockTime(Number(slot)).catch(() => null);
      if (t == null) continue;
      const blockTime = new Date(t * 1000);
      await this.db.$transaction([
        this.db.indexedEvent.updateMany({ where: { slot, blockTime: null }, data: { blockTime } }),
        this.db.deposit.updateMany({ where: { slot, blockTime: null }, data: { blockTime } }),
        this.db.claim.updateMany({ where: { slot, blockTime: null }, data: { blockTime } }),
      ]);
    }
  }
}
