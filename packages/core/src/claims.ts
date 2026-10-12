/**
 * Claims: a wallet signs a message asking for everything it has earned. The
 * server bundles every settled, unpaid position into one Payout row; the
 * engine then sends the $TUNNEL on-chain from the reward wallet (paying the
 * fees itself). At most one unfinished payout per wallet (partial unique index).
 */
import { isFresh, parseClaimMessage } from "@tunnel/sdk";
import type { Db, Tx } from "./config";
import { uniqueToReplay } from "./deploy";
import { ProtocolError } from "./errors";
import { isAddress, verifySignature } from "./signature";

export async function claimableFor(db: Tx, wallet: string): Promise<{ amount: bigint; cycles: number }> {
  const [row] = await db.$queryRaw<{ amount: bigint | null; cycles: bigint }[]>`
    SELECT COALESCE(SUM("payout"), 0)::bigint AS amount, COUNT(*)::bigint AS cycles
    FROM "Position" WHERE "wallet" = ${wallet} AND "settled" AND "payout" > 0 AND "payoutId" IS NULL`;
  return { amount: BigInt(row?.amount ?? 0n), cycles: Number(row?.cycles ?? 0n) };
}

export async function requestClaim(db: Db, input: { message: string; signature: string }, now = new Date()) {
  if (typeof input?.message !== "string" || typeof input?.signature !== "string" || input.message.length > 1_000) {
    throw new ProtocolError("bad_request", "Expected { message, signature }.");
  }
  const intent = parseClaimMessage(input.message);
  if (!intent || !isAddress(intent.wallet)) throw new ProtocolError("bad_message", "The signed message is not a valid TUNNEL claim.");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(intent.nonce)) throw new ProtocolError("bad_message", "Invalid nonce.");
  if (!isFresh(intent.issuedAt, now.getTime())) throw new ProtocolError("stale_message", "This signed request has expired. Please sign again.");
  verifySignature(input.message, input.signature, intent.wallet);

  try {
    return await db.$transaction(async (tx) => {
      await tx.usedNonce.create({ data: { nonce: intent.nonce, wallet: intent.wallet } });
      const open = await tx.payout.findFirst({ where: { wallet: intent.wallet, status: { in: ["requested", "sending"] } } });
      if (open) throw new ProtocolError("claim_pending", "A payout to this wallet is already on its way.", 409);

      // Lock this wallet's claimable positions so a concurrent settlement/claim cannot double-count.
      const rows = await tx.$queryRaw<{ cycleId: bigint; payout: bigint }[]>`
        SELECT "cycleId", "payout" FROM "Position"
        WHERE "wallet" = ${intent.wallet} AND "settled" AND "payout" > 0 AND "payoutId" IS NULL
        FOR UPDATE`;
      const amount = rows.reduce((s, r) => s + BigInt(r.payout), 0n);
      if (amount <= 0n) throw new ProtocolError("nothing_to_claim", "Nothing to claim yet.", 409);

      const payout = await tx.payout.create({
        data: { wallet: intent.wallet, amount, message: input.message, messageSignature: input.signature, createdAt: now },
      });
      await tx.position.updateMany({
        where: { wallet: intent.wallet, cycleId: { in: rows.map((r) => r.cycleId) }, payoutId: null },
        data: { payoutId: payout.id },
      });
      await tx.protocolEvent.create({
        data: { name: "ClaimRequested", wallet: intent.wallet, data: { payoutId: payout.id.toString(), amount: amount.toString(), cycles: rows.length } },
      });
      return { payoutId: payout.id, amount, cycles: rows.length };
    });
  } catch (e) {
    throw uniqueToReplay(e);
  }
}

// ------------------------------------------------------------------ engine side

/** Marks a payout as being sent — saved BEFORE broadcasting so a crash can never cause a second, different transfer. */
export async function markSending(db: Db, id: bigint, txSignature: string, lastValidBlockHeight: bigint) {
  const n = await db.payout.updateMany({
    where: { id, status: "requested" },
    data: { status: "sending", txSignature, lastValidBlockHeight, attempts: { increment: 1 }, error: null },
  });
  return n.count === 1;
}

export async function confirmPayout(db: Db, id: bigint, now = new Date()) {
  return db.$transaction(async (tx) => {
    const p = await tx.payout.findUnique({ where: { id } });
    if (!p || p.status !== "sending") return null;
    await tx.payout.update({ where: { id }, data: { status: "confirmed", confirmedAt: now } });
    const cycles = (await tx.position.findMany({ where: { payoutId: id }, select: { cycleId: true } })).map((r) => r.cycleId);
    await tx.experiment.updateMany({ where: { wallet: p.wallet, cycleId: { in: cycles }, status: "settled" }, data: { status: "claimed" } });
    await tx.protocolEvent.create({
      data: { name: "RewardClaimed", wallet: p.wallet, data: { payoutId: id.toString(), amount: p.amount.toString(), txSignature: p.txSignature, cycles: cycles.map(String) } },
    });
    return p;
  });
}

/** The transaction expired unconfirmed (verified by the caller): allow a fresh attempt. */
export async function resetExpiredPayout(db: Db, id: bigint, note: string) {
  await db.payout.updateMany({ where: { id, status: "sending" }, data: { status: "requested", txSignature: null, lastValidBlockHeight: null, error: note } });
}

/** A transfer failed on-chain: return the amount to the wallet's claimable balance. */
export async function failPayout(db: Db, id: bigint, error: string) {
  return db.$transaction(async (tx) => {
    const p = await tx.payout.findUnique({ where: { id } });
    if (!p || (p.status !== "sending" && p.status !== "requested")) return false;
    await tx.payout.update({ where: { id }, data: { status: "failed", error } });
    await tx.position.updateMany({ where: { payoutId: id }, data: { payoutId: null } });
    await tx.protocolEvent.create({ data: { name: "ClaimFailed", wallet: p.wallet, data: { payoutId: id.toString(), amount: p.amount.toString(), error } } });
    return true;
  });
}
