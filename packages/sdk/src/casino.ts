/**
 * Instant particle bets.
 *
 * A bet fires `count` particles of `amount` $TUNNEL each at one volatility
 * level. Each particle tunnels with the level's probability and pays
 * `amount × multiplier` when it does.
 *
 * Provably fair: every wallet has a server seed whose hash is shown before it
 * is used, a client seed the player controls, and a nonce that increases with
 * each bet. Particle i of a bet is drawn as
 *
 *   draw = u64_le(HMAC-SHA256(key = serverSeed, "TUNNEL/bet/v1:{clientSeed}:{nonce}:{i}")[0..8])
 *   tunnels ⇔ draw < ⌊ppb · 2⁶⁴ / 10⁹⌋
 *
 * When the player rotates seeds, the old server seed is revealed and every
 * past bet made with it can be recomputed.
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { fromHex, toHex } from "./bytes";
import { successThreshold } from "./math";

export interface Volatility {
  key: "low" | "medium" | "high";
  name: string;
  short: string;
  /** Win probability, parts per billion. */
  ppb: number;
  /** Payout multiplier on a win, basis points (18_600 = 1.86×). */
  multiplierBps: number;
  color: string;
}

const PPB = 1_000_000_000;
/** Return to player in bps. Multiplier = RTP / probability. */
const RTP_BPS = 9_300;
const level = (ppb: number) => Math.round((RTP_BPS * PPB) / ppb);

export const VOLATILITY: readonly Volatility[] = [
  { key: "low", name: "Low volatility", short: "LOW", ppb: 500_000_000, multiplierBps: level(500_000_000), color: "#00D9FF" },
  { key: "medium", name: "Medium volatility", short: "MEDIUM", ppb: 200_000_000, multiplierBps: level(200_000_000), color: "#2864FF" },
  { key: "high", name: "High volatility", short: "HIGH", ppb: 50_000_000, multiplierBps: level(50_000_000), color: "#885BFF" },
];

export const MAX_PARTICLES_PER_BET = 20;
export const BET_DOMAIN = "TUNNEL/bet/v1";

const enc = new TextEncoder();

/** The hash shown to the player before a server seed is used. */
export function hashServerSeed(serverSeedHex: string): string {
  return toHex(sha256(fromHex(serverSeedHex)));
}

export function particleDrawFor(serverSeedHex: string, clientSeed: string, nonce: number, index: number): bigint {
  const mac = hmac(sha256, fromHex(serverSeedHex), enc.encode(`${BET_DOMAIN}:${clientSeed}:${nonce}:${index}`));
  return new DataView(mac.buffer, mac.byteOffset, 8).getBigUint64(0, true);
}

export interface BetOutcome {
  /** One entry per particle. */
  hits: boolean[];
  wins: number;
  /** Total returned to the player (stake included), base units. */
  payout: bigint;
}

/** Resolves a bet. Pure: same inputs, same result, on the server and in the browser. */
export function resolveBet(p: { serverSeed: string; clientSeed: string; nonce: number; volatility: number; amount: bigint; count: number }): BetOutcome {
  const v = VOLATILITY[p.volatility];
  if (!v) throw new Error("unknown volatility");
  const t = successThreshold(v.ppb);
  const hits = Array.from({ length: p.count }, (_, i) => particleDrawFor(p.serverSeed, p.clientSeed, p.nonce, i) < t);
  const wins = hits.filter(Boolean).length;
  return { hits, wins, payout: (p.amount * BigInt(v.multiplierBps) * BigInt(wins)) / 10_000n };
}

/** "1.86×" */
export const formatMultiplier = (bps: number) => `${(bps / 10_000).toFixed(bps % 100 === 0 ? 2 : 3).replace(/0$/, "")}×`;

/** "50%" */
export const formatChance = (ppb: number) => `${+(ppb / 10_000_000).toFixed(2)}%`;

export function randomSeedHex(bytes = 32): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export interface WithdrawalIntent {
  wallet: string;
  amount: string;
  nonce: string;
  issuedAt: string;
}

/** The exact text a wallet signs to withdraw $TUNNEL from its balance. */
export function withdrawalMessage(w: WithdrawalIntent): string {
  return [
    "TUNNEL — withdraw",
    "",
    "Signing this message is free. TUNNEL will send this amount of $TUNNEL from your balance to this wallet.",
    "",
    `Wallet: ${w.wallet}`,
    `Amount: ${w.amount} $TUNNEL`,
    `Nonce: ${w.nonce}`,
    `Issued: ${w.issuedAt}`,
  ].join("\n");
}

export function parseWithdrawalMessage(msg: string): WithdrawalIntent | null {
  const get = (k: string) => new RegExp(`^${k}: (.+)$`, "m").exec(msg)?.[1];
  const amount = /^([0-9]+(?:\.[0-9]{1,6})?) \$TUNNEL$/.exec(get("Amount") ?? "")?.[1];
  const w = { wallet: get("Wallet") ?? "", amount: amount ?? "", nonce: get("Nonce") ?? "", issuedAt: get("Issued") ?? "" };
  if (!w.wallet || !w.amount || !w.nonce || !w.issuedAt) return null;
  return withdrawalMessage(w) === msg ? w : null;
}
