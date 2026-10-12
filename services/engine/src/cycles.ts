import type { Connection } from "@solana/web3.js";
import { SLOT_MS, closeDueCycles, openCycle, recomputeWalletStats, settleCycle, voidCycle, type Db } from "@tunnel/core";
import { log } from "./log";
import { entropyBlock } from "./solana";

export interface CycleTickResult {
  slot: bigint;
  closed: bigint[];
  settled: bigint[];
  voided: bigint[];
  open: string;
}

let slotRate = { ms: SLOT_MS, at: 0 };

/** The chain's recent average slot time (local validators are often slower than mainnet's ~400 ms). */
async function measuredSlotMs(conn: Connection, now: number): Promise<number> {
  if (now - slotRate.at < 60_000) return slotRate.ms;
  try {
    const samples = await conn.getRecentPerformanceSamples(10);
    const slots = samples.reduce((a, s) => a + s.numSlots, 0);
    const secs = samples.reduce((a, s) => a + s.samplePeriodSecs, 0);
    if (slots > 0) slotRate = { ms: Math.min(2_000, Math.max(200, (secs * 1000) / slots)), at: now };
  } catch {
    slotRate = { ms: SLOT_MS, at: now };
  }
  return slotRate.ms;
}

/** One pass of the cycle state machine: close → settle/void → open. Safe to repeat. */
export async function cycleTick(conn: Connection, db: Db, voidAfterMs: number, now = new Date()): Promise<CycleTickResult> {
  const slot = BigInt(await conn.getSlot("confirmed"));
  await db.protocolConfig.update({ where: { id: 1 }, data: { lastSlot: slot, engineHeartbeat: now } });

  const closed = await closeDueCycles(db, now, slot);
  for (const id of closed) log.info({ cycle: id.toString(), slot: slot.toString() }, "cycle closed");

  const settled: bigint[] = [];
  const voided: bigint[] = [];
  const pending = await db.cycle.findMany({ where: { status: "closed" }, orderBy: { id: "asc" }, select: { id: true, entropySlot: true, closedAt: true } });
  for (const c of pending) {
    const entropy = await entropyBlock(conn, c.entropySlot);
    if (entropy) {
      const r = await settleCycle(db, c.id, entropy, now);
      if (r) {
        settled.push(c.id);
        for (const w of r.wallets) await recomputeWalletStats(db, w);
        log.info({ cycle: c.id.toString(), outcome: r.outcome, allocated: r.allocated.toString(), entropySlot: entropy.slot.toString() }, "cycle settled");
      }
    } else if (c.closedAt && now.getTime() - c.closedAt.getTime() > voidAfterMs) {
      if (await voidCycle(db, c.id, "entropy block unavailable", now)) {
        voided.push(c.id);
        log.warn({ cycle: c.id.toString() }, "cycle voided: entropy block unavailable");
      }
    }
  }

  const opened = await openCycle(db, now, slot, await measuredSlotMs(conn, now.getTime()));
  if (opened.opened) log.info({ cycle: opened.id.toString() }, "cycle opened");
  return { slot, closed, settled, voided, open: opened.opened ? `opened ${opened.id}` : opened.reason };
}
