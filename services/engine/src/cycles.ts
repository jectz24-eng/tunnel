import type { Connection } from "@solana/web3.js";
import { closeDueCycles, openCycle, recomputeWalletStats, settleCycle, voidCycle, type Db } from "@tunnel/core";
import { log } from "./log";
import { entropyBlock } from "./solana";

export interface CycleTickResult {
  slot: bigint;
  closed: bigint[];
  settled: bigint[];
  voided: bigint[];
  open: string;
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

  const opened = await openCycle(db, now, slot);
  if (opened.opened) log.info({ cycle: opened.id.toString() }, "cycle opened");
  return { slot, closed, settled, voided, open: opened.opened ? `opened ${opened.id}` : opened.reason };
}
