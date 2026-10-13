/**
 * Instant $TUNNEL betting. Every balance change happens inside a database
 * transaction holding the player's Account row lock, so concurrent bets,
 * deposits and withdrawals can never overdraw or double-count.
 */
import {
  MAX_PARTICLES_PER_BET,
  VOLATILITY,
  hashServerSeed,
  isFresh,
  parseTunnel,
  parseWithdrawalMessage,
  resolveBet,
} from "@tunnel/sdk";
import { randomBytes } from "node:crypto";
import type { Db, Tx } from "./config";
import { uniqueToReplay } from "./deploy";
import { ProtocolError } from "./errors";
import { isAddress, verifySignature } from "./signature";

const newServerSeed = () => randomBytes(32).toString("hex");
const newClientSeed = () => randomBytes(8).toString("hex");
const CLIENT_SEED_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface CasinoLimits {
  minBet: bigint;
  maxBet: bigint;
  maxWinBps: number;
  bettingPaused: boolean;
  /** $TUNNEL in the house wallet not owed to players; null until the engine has reported balances. */
  freeBankroll: bigint | null;
}

/** Everything players are owed right now: balances plus withdrawals not yet confirmed on-chain. */
async function liabilities(db: Tx): Promise<bigint> {
  const [row] = await db.$queryRaw<{ owed: bigint | null }[]>`
    SELECT (COALESCE((SELECT SUM("balance") FROM "Account"), 0)
          + COALESCE((SELECT SUM("amount") FROM "Payout" WHERE "kind" = 'withdrawal' AND "status" IN ('requested', 'sending')), 0))::bigint AS owed`;
  return BigInt(row?.owed ?? 0n);
}

export async function casinoLimits(db: Tx): Promise<CasinoLimits> {
  const c = await db.protocolConfig.findUnique({ where: { id: 1 } });
  if (!c) throw new ProtocolError("unavailable", "Betting is not configured yet.", 503);
  const free = c.rewardWalletTokens == null ? null : c.rewardWalletTokens - (await liabilities(db));
  return { minBet: c.minBet, maxBet: c.maxBet, maxWinBps: c.maxWinBps, bettingPaused: c.bettingPaused, freeBankroll: free == null ? null : free > 0n ? free : 0n };
}

/** The player's active seed pair (created on first use). The server seed itself is never returned while active. */
export async function activeSeedPair(db: Tx, wallet: string) {
  const existing = await db.seedPair.findFirst({ where: { wallet, active: true } });
  if (existing) return existing;
  const serverSeed = newServerSeed();
  return db.seedPair.create({ data: { wallet, serverSeed, serverSeedHash: hashServerSeed(serverSeed), clientSeed: newClientSeed() } });
}

export const publicSeedPair = (s: { id: bigint; serverSeedHash: string; clientSeed: string; nonce: number; serverSeed: string; active: boolean; revealedAt: Date | null; createdAt: Date }) => ({
  id: s.id,
  serverSeedHash: s.serverSeedHash,
  clientSeed: s.clientSeed,
  nonce: s.nonce,
  active: s.active,
  serverSeed: s.active ? null : s.serverSeed,
  revealedAt: s.revealedAt,
  createdAt: s.createdAt,
});

export interface BetInput {
  volatility: number;
  /** Stake per particle, base units. */
  amount: bigint;
  count: number;
}

export async function placeBet(db: Db, wallet: string, input: BetInput, now = new Date()) {
  if (!isAddress(wallet)) throw new ProtocolError("unauthorized", "Sign in with your wallet first.", 401);
  const v = VOLATILITY[input.volatility];
  if (!v) throw new ProtocolError("bad_bet", "Pick a volatility level.");
  if (!(Number.isInteger(input.count) && input.count >= 1 && input.count <= MAX_PARTICLES_PER_BET)) {
    throw new ProtocolError("bad_bet", `Fire between 1 and ${MAX_PARTICLES_PER_BET} particles.`);
  }
  if (typeof input.amount !== "bigint" || input.amount <= 0n) throw new ProtocolError("bad_bet", "Enter a bet amount.");

  return db.$transaction(async (tx) => {
    const limits = await casinoLimits(tx);
    if (limits.bettingPaused) throw new ProtocolError("paused", "The accelerator is offline for a moment. Try again shortly.", 409);
    if (input.amount < limits.minBet || input.amount > limits.maxBet) throw new ProtocolError("bad_bet", "That amount is outside the bet limits.");
    // No cap against the vault balance (operator decision): bets are limited only by min/max bet and
    // particle count. Wins larger than the vault holds are credited; withdrawals wait until it is topped up.
    const stake = input.amount * BigInt(input.count);

    const [acct] = await tx.$queryRaw<{ balance: bigint }[]>`SELECT "balance" FROM "Account" WHERE "wallet" = ${wallet} FOR UPDATE`;
    if (!acct || BigInt(acct.balance) < stake) throw new ProtocolError("balance", "Not enough balance. Deposit $TUNNEL to keep firing.", 409);

    const seed = await activeSeedPair(tx, wallet);
    const [locked] = await tx.$queryRaw<{ nonce: number }[]>`SELECT "nonce" FROM "SeedPair" WHERE "id" = ${seed.id} FOR UPDATE`;
    const nonce = locked.nonce;
    const out = resolveBet({ serverSeed: seed.serverSeed, clientSeed: seed.clientSeed, nonce, volatility: input.volatility, amount: input.amount, count: input.count });

    await tx.seedPair.update({ where: { id: seed.id }, data: { nonce: nonce + 1 } });
    const bet = await tx.bet.create({
      data: {
        wallet,
        seedPairId: seed.id,
        nonce,
        volatility: input.volatility,
        amount: input.amount,
        count: input.count,
        winPpb: v.ppb,
        multiplierBps: v.multiplierBps,
        wins: out.wins,
        payout: out.payout,
        outcomeBits: out.hits.map((h) => (h ? "1" : "0")).join(""),
        createdAt: now,
      },
    });
    const updated = await tx.$queryRaw<{ balance: bigint }[]>`
      UPDATE "Account" SET
        "balance" = "balance" - ${stake} + ${out.payout},
        "wagered" = "wagered" + ${stake},
        "returned" = "returned" + ${out.payout},
        "bets" = "bets" + 1,
        "particles" = "particles" + ${input.count},
        "hits" = "hits" + ${out.wins},
        "biggestWin" = GREATEST("biggestWin", ${out.payout}),
        "updatedAt" = ${now}
      WHERE "wallet" = ${wallet}
      RETURNING "balance"`;
    return { bet, hits: out.hits, wins: out.wins, payout: out.payout, stake, balance: BigInt(updated[0].balance), serverSeedHash: seed.serverSeedHash, clientSeed: seed.clientSeed };
  });
}

/** Reveals the active server seed and starts a new pair (optionally with the player's own client seed). */
export async function rotateSeed(db: Db, wallet: string, clientSeed?: string, now = new Date()) {
  if (clientSeed != null && !CLIENT_SEED_RE.test(clientSeed)) throw new ProtocolError("bad_seed", "Client seeds use letters, numbers, - and _ (max 64).");
  return db.$transaction(async (tx) => {
    const old = await activeSeedPair(tx, wallet);
    await tx.$executeRaw`SELECT 1 FROM "SeedPair" WHERE "id" = ${old.id} FOR UPDATE`;
    const revealed = await tx.seedPair.update({ where: { id: old.id }, data: { active: false, revealedAt: now } });
    const serverSeed = newServerSeed();
    const next = await tx.seedPair.create({ data: { wallet, serverSeed, serverSeedHash: hashServerSeed(serverSeed), clientSeed: clientSeed ?? newClientSeed() } });
    return { revealed: publicSeedPair(revealed), next: publicSeedPair(next) };
  });
}

/** Credits an on-chain deposit exactly once (keyed by transaction signature). */
export async function creditDeposit(db: Db, d: { wallet: string; amount: bigint; txSignature: string; slot: bigint }) {
  if (d.amount <= 0n) return false;
  try {
    return await db.$transaction(async (tx) => {
      // Vault funding is not a player deposit: skip transfers recorded as reserve funding,
      // and anything sent by a wallet that has funded the vault.
      const funding = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*)::bigint AS n FROM "ProtocolEvent"
        WHERE "name" = 'ReserveFunded' AND ("wallet" = ${d.wallet} OR "data"->>'txSignature' = ${d.txSignature})`;
      if (BigInt(funding[0]?.n ?? 0n) > 0n) return false;
      await tx.deposit.create({ data: d });
      await tx.$executeRaw`
        INSERT INTO "Account" ("wallet", "balance", "deposited", "updatedAt") VALUES (${d.wallet}, ${d.amount}, ${d.amount}, NOW())
        ON CONFLICT ("wallet") DO UPDATE SET "balance" = "Account"."balance" + ${d.amount}, "deposited" = "Account"."deposited" + ${d.amount}, "updatedAt" = NOW()`;
      await tx.protocolEvent.create({ data: { name: "Deposit", wallet: d.wallet, data: { amount: d.amount.toString(), txSignature: d.txSignature } } });
      return true;
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002" || /Unique constraint|duplicate key/i.test(String((e as Error)?.message))) return false;
    throw e;
  }
}

export const MIN_WITHDRAWAL = 1_000_000n; // 1 $TUNNEL

/** A signed request to withdraw part of the balance. The engine sends it on-chain. */
export async function requestWithdrawal(db: Db, input: { message: string; signature: string }, now = new Date()) {
  if (typeof input?.message !== "string" || typeof input?.signature !== "string" || input.message.length > 1_000) {
    throw new ProtocolError("bad_request", "Expected { message, signature }.");
  }
  const intent = parseWithdrawalMessage(input.message);
  if (!intent || !isAddress(intent.wallet)) throw new ProtocolError("bad_message", "The signed message is not a valid TUNNEL withdrawal.");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(intent.nonce)) throw new ProtocolError("bad_message", "Invalid nonce.");
  if (!isFresh(intent.issuedAt, now.getTime())) throw new ProtocolError("stale_message", "This signed request has expired. Please sign again.");
  verifySignature(input.message, input.signature, intent.wallet);
  const amount = parseTunnel(intent.amount);
  if (amount == null || amount < MIN_WITHDRAWAL) throw new ProtocolError("bad_amount", "The minimum withdrawal is 1 $TUNNEL.");

  try {
    return await db.$transaction(async (tx) => {
      await tx.usedNonce.create({ data: { nonce: intent.nonce, wallet: intent.wallet } });
      const [acct] = await tx.$queryRaw<{ balance: bigint }[]>`SELECT "balance" FROM "Account" WHERE "wallet" = ${intent.wallet} FOR UPDATE`;
      if (!acct || BigInt(acct.balance) < amount) throw new ProtocolError("balance", "That is more than your balance.", 409);
      const open = await tx.payout.findFirst({ where: { wallet: intent.wallet, status: { in: ["requested", "sending"] } } });
      if (open) throw new ProtocolError("withdrawal_pending", "A withdrawal to this wallet is already on its way.", 409);
      const payout = await tx.payout.create({ data: { kind: "withdrawal", wallet: intent.wallet, amount, message: input.message, messageSignature: input.signature, createdAt: now } });
      await tx.account.update({ where: { wallet: intent.wallet }, data: { balance: { decrement: amount }, withdrawn: { increment: amount } } });
      await tx.protocolEvent.create({ data: { name: "WithdrawalRequested", wallet: intent.wallet, data: { payoutId: payout.id.toString(), amount: amount.toString() } } });
      return { payoutId: payout.id, amount };
    });
  } catch (e) {
    throw uniqueToReplay(e);
  }
}

export async function setBetLimits(db: Db, l: { minBet?: bigint; maxBet?: bigint; maxWinBps?: number; bettingPaused?: boolean }, actor: string) {
  const c = await db.protocolConfig.findUnique({ where: { id: 1 } });
  if (!c) throw new ProtocolError("unavailable", "Not configured.", 503);
  const minBet = l.minBet ?? c.minBet;
  const maxBet = l.maxBet ?? c.maxBet;
  const maxWinBps = l.maxWinBps ?? c.maxWinBps;
  if (minBet <= 0n || maxBet < minBet) throw new ProtocolError("bad_params", "Max bet must be at least the min bet, and both positive.");
  if (!(maxWinBps >= 1 && maxWinBps <= 10_000)) throw new ProtocolError("bad_params", "Max win share must be 0.01%–100%.");
  await db.$transaction([
    db.protocolConfig.update({ where: { id: 1 }, data: { minBet, maxBet, maxWinBps, bettingPaused: l.bettingPaused ?? c.bettingPaused } }),
    db.protocolEvent.create({ data: { name: "BetLimitsUpdated", wallet: actor, data: { minBet: minBet.toString(), maxBet: maxBet.toString(), maxWinBps, bettingPaused: l.bettingPaused ?? c.bettingPaused } } }),
  ]);
}
