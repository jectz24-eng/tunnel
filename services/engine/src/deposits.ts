/**
 * Deposit watcher: credits $TUNNEL transferred into the house token account.
 * Reads finalized transactions only, credits each signature once (unique in
 * the database), and attributes the deposit to the wallet whose $TUNNEL
 * balance went down in that transaction.
 */
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { Connection, ParsedTransactionWithMeta, PublicKey } from "@solana/web3.js";
import { creditDeposit, type Db } from "@tunnel/core";
import { log } from "./log";

export interface DepositContext {
  conn: Connection;
  db: Db;
  house: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
}

/** The single depositor and amount of a transfer into the house account, or null. */
export function depositOf(tx: ParsedTransactionWithMeta, house: string, mint: string): { wallet: string; amount: bigint } | null {
  const meta = tx.meta;
  if (!meta || meta.err) return null;
  const amountOf = (list: typeof meta.preTokenBalances, owner: string) =>
    (list ?? []).filter((b) => b.mint === mint && b.owner === owner).reduce((a, b) => a + BigInt(b.uiTokenAmount.amount), 0n);
  const owners = new Set([...(meta.preTokenBalances ?? []), ...(meta.postTokenBalances ?? [])].filter((b) => b.mint === mint && b.owner).map((b) => b.owner!));
  const received = amountOf(meta.postTokenBalances, house) - amountOf(meta.preTokenBalances, house);
  if (received <= 0n) return null;
  let sender: { wallet: string; sent: bigint } | null = null;
  for (const o of owners) {
    if (o === house) continue;
    const sent = amountOf(meta.preTokenBalances, o) - amountOf(meta.postTokenBalances, o);
    if (sent > 0n && (!sender || sent > sender.sent)) sender = { wallet: o, sent };
  }
  if (!sender) return null;
  return { wallet: sender.wallet, amount: received < sender.sent ? received : sender.sent };
}

export async function scanDeposits(ctx: DepositContext) {
  const ata = getAssociatedTokenAddressSync(ctx.mint, ctx.house, false, ctx.tokenProgram);
  const cfg = await ctx.db.protocolConfig.findUnique({ where: { id: 1 }, select: { depositCursor: true } });
  const sigs = await ctx.conn.getSignaturesForAddress(ata, { until: cfg?.depositCursor ?? undefined, limit: 200 }, "finalized");
  if (sigs.length === 0) return;
  // Oldest first, so the cursor only ever advances past processed transactions.
  for (const s of [...sigs].reverse()) {
    if (!s.err) {
      const tx = await ctx.conn.getParsedTransaction(s.signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
      const d = tx && depositOf(tx, ctx.house.toBase58(), ctx.mint.toBase58());
      if (d && (await creditDeposit(ctx.db, { wallet: d.wallet, amount: d.amount, txSignature: s.signature, slot: BigInt(s.slot) }))) {
        log.info({ wallet: d.wallet, amount: d.amount.toString(), signature: s.signature }, "deposit credited");
      }
    }
    await ctx.db.protocolConfig.update({ where: { id: 1 }, data: { depositCursor: s.signature } });
  }
}
