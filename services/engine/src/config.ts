import "dotenv/config";
import { Keypair, PublicKey } from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";

function keypair(path: string | undefined): Keypair | null {
  if (!path) return null;
  if (!existsSync(path)) throw new Error(`REWARD_WALLET_KEYPAIR not found: ${path}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

export const config = {
  rpcUrl: process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899",
  /**
   * Holds the $TUNNEL mining reserve and pays transfer fees. The only secret
   * key in the system; lives only on the engine (a Render secret file).
   */
  rewardWallet: keypair(process.env.REWARD_WALLET_KEYPAIR),
  tunnelMint: process.env.TUNNEL_MINT ? new PublicKey(process.env.TUNNEL_MINT) : null,
  tickMs: Number(process.env.ENGINE_TICK_MS ?? 2_000),
  payoutTickMs: Number(process.env.ENGINE_PAYOUT_TICK_MS ?? 4_000),
  balanceTickMs: Number(process.env.ENGINE_BALANCE_TICK_MS ?? 30_000),
  /** A closed cycle whose entropy block still cannot be read after this long is voided. */
  voidAfterMs: Number(process.env.ENGINE_VOID_AFTER_MS ?? 60 * 60_000),
  /** Safety cap in whole $TUNNEL: larger payouts wait for an operator (docs/SECURITY.md). */
  maxPayoutTokens: BigInt(process.env.ENGINE_MAX_PAYOUT_TOKENS ?? "1000000"),
  /** Keep at least this much SOL for fees; payouts wait below it. */
  minFeeLamports: BigInt(process.env.ENGINE_MIN_FEE_LAMPORTS ?? "20000000"),
  healthPort: Number(process.env.PORT ?? process.env.ENGINE_HEALTH_PORT ?? 8787),
};
