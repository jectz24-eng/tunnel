/**
 * Sends claimed $TUNNEL from the reward wallet. Exactly-once by construction:
 *  - a payout's transaction is signed and its signature + lastValidBlockHeight
 *    are saved (status `sending`) BEFORE it is broadcast;
 *  - a `sending` payout is only re-signed after that blockhash has expired
 *    AND the signature is absent from history, so two different transfers
 *    for one payout can never both land.
 */
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, Transaction, type Connection, type Keypair } from "@solana/web3.js";
import { confirmPayout, failPayout, markSending, recomputeWalletStats, resetExpiredPayout, type Db } from "@tunnel/core";
import { TUNNEL_DECIMALS, TUNNEL_UNIT, encodeBase58 } from "@tunnel/sdk";
import { log } from "./log";

export interface PayoutContext {
  conn: Connection;
  db: Db;
  wallet: Keypair;
  mint: PublicKey;
  tokenProgram: PublicKey;
  maxPayoutTokens: bigint;
  minFeeLamports: bigint;
}

/** SPL Token or Token-2022, whichever owns the mint; checks the decimals. */
export async function resolveTokenProgram(conn: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await conn.getAccountInfo(mint);
  if (!info) throw new Error(`TUNNEL_MINT ${mint.toBase58()} does not exist on this cluster`);
  const m = await getMint(conn, mint, "confirmed", info.owner);
  if (m.decimals !== TUNNEL_DECIMALS) throw new Error(`mint has ${m.decimals} decimals, expected ${TUNNEL_DECIMALS}`);
  return info.owner;
}

export function buildPayoutTx(ctx: Pick<PayoutContext, "wallet" | "mint" | "tokenProgram">, recipient: PublicKey, amount: bigint, blockhash: string) {
  const from = getAssociatedTokenAddressSync(ctx.mint, ctx.wallet.publicKey, false, ctx.tokenProgram);
  const to = getAssociatedTokenAddressSync(ctx.mint, recipient, true, ctx.tokenProgram);
  const tx = new Transaction({ feePayer: ctx.wallet.publicKey, recentBlockhash: blockhash }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    createAssociatedTokenAccountIdempotentInstruction(ctx.wallet.publicKey, to, recipient, ctx.mint, ctx.tokenProgram),
    createTransferCheckedInstruction(from, ctx.mint, to, ctx.wallet.publicKey, amount, TUNNEL_DECIMALS, [], ctx.tokenProgram),
  );
  tx.sign(ctx.wallet);
  return tx;
}

/** Signs, records and broadcasts the oldest requested payouts. */
export async function sendRequested(ctx: PayoutContext, limit = 5) {
  const queue = await ctx.db.payout.findMany({ where: { status: "requested" }, orderBy: { id: "asc" }, take: limit });
  if (queue.length === 0) return;
  const lamports = BigInt(await ctx.conn.getBalance(ctx.wallet.publicKey, "confirmed"));
  if (lamports < ctx.minFeeLamports) {
    log.warn({ lamports: lamports.toString() }, "reward wallet SOL below fee floor; payouts waiting");
    return;
  }
  const source = getAssociatedTokenAddressSync(ctx.mint, ctx.wallet.publicKey, false, ctx.tokenProgram);
  let tokens = BigInt((await ctx.conn.getTokenAccountBalance(source, "confirmed")).value.amount);

  for (const p of queue) {
    if (p.amount > ctx.maxPayoutTokens * TUNNEL_UNIT) {
      log.warn({ payout: p.id.toString(), amount: p.amount.toString() }, "payout above safety cap; waiting for operator review");
      continue;
    }
    if (p.amount > tokens) {
      log.error({ payout: p.id.toString(), amount: p.amount.toString(), tokens: tokens.toString() }, "reward wallet cannot cover payout; waiting");
      break;
    }
    let recipient: PublicKey;
    try {
      recipient = new PublicKey(p.wallet);
    } catch {
      await failPayout(ctx.db, p.id, "invalid recipient");
      continue;
    }
    const { blockhash, lastValidBlockHeight } = await ctx.conn.getLatestBlockhash("confirmed");
    const tx = buildPayoutTx(ctx, recipient, p.amount, blockhash);
    const signature = encodeBase58(tx.signature!);
    if (!(await markSending(ctx.db, p.id, signature, BigInt(lastValidBlockHeight)))) continue;
    try {
      await ctx.conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed", maxRetries: 5 });
      tokens -= p.amount;
      log.info({ payout: p.id.toString(), wallet: p.wallet, amount: p.amount.toString(), signature }, "payout sent");
    } catch (e) {
      // Not broadcast (or rejected in preflight). It stays `sending`;
      // reconcileSending re-queues it once the blockhash has provably expired.
      log.error({ payout: p.id.toString(), err: String(e) }, "payout broadcast failed");
    }
  }
}

/** Confirms, fails, or (after verified expiry) re-queues payouts in flight. */
export async function reconcileSending(ctx: Pick<PayoutContext, "conn" | "db">) {
  const inflight = await ctx.db.payout.findMany({ where: { status: "sending" }, orderBy: { id: "asc" }, take: 100 });
  if (inflight.length === 0) return;
  const statuses = (await ctx.conn.getSignatureStatuses(inflight.map((p) => p.txSignature!), { searchTransactionHistory: true })).value;
  const height = BigInt(await ctx.conn.getBlockHeight("confirmed"));

  for (const [i, p] of inflight.entries()) {
    const s = statuses[i];
    if (s?.err) {
      await failPayout(ctx.db, p.id, `transaction failed: ${JSON.stringify(s.err)}`);
      await recomputeWalletStats(ctx.db, p.wallet);
      log.error({ payout: p.id.toString(), err: s.err }, "payout failed on-chain; amount returned to claimable");
    } else if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) {
      await confirmPayout(ctx.db, p.id);
      await recomputeWalletStats(ctx.db, p.wallet);
      log.info({ payout: p.id.toString(), signature: p.txSignature }, "payout confirmed");
    } else if (!s && p.lastValidBlockHeight != null && height > p.lastValidBlockHeight + 10n) {
      // Expired and absent from history: it can never land now, so re-signing is safe.
      await resetExpiredPayout(ctx.db, p.id, "previous attempt expired unconfirmed");
      log.warn({ payout: p.id.toString() }, "payout expired; re-queued");
    }
  }
}
