import "dotenv/config";
import { Keypair, PublicKey } from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";

function keypair(path: string | undefined): Keypair | null {
  if (!path) return null;
  if (!existsSync(path)) {
    // Not uploaded yet (e.g. the Render secret file): run without payouts instead of crash-looping.
    console.warn(`REWARD_WALLET_KEYPAIR not found: ${path}; payouts and deposits stay off until it exists`);
    return null;
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

export const config = {
  /** Env pins the RPC; otherwise it comes from the /admin setting (ProtocolConfig.engineRpcUrl). */
  rpcUrl: process.env.SOLANA_RPC_URL || null,
  defaultRpcUrl: "http://127.0.0.1:8899",
  /**
   * Holds the $TUNNEL mining reserve and pays transfer fees. The only secret
   * key in the system; lives only on the engine (a Render secret file).
   */
  rewardWallet: keypair(process.env.REWARD_WALLET_KEYPAIR),
  /** Env pins the mint; otherwise it comes from the /admin setting (ProtocolConfig.tunnelMint). */
  tunnelMint: process.env.TUNNEL_MINT ? new PublicKey(process.env.TUNNEL_MINT) : null,
  /** How often to check /admin settings; a change restarts the engine (the host restarts the process). */
  settingsTickMs: Number(process.env.ENGINE_SETTINGS_TICK_MS ?? 10_000),
  tickMs: Number(process.env.ENGINE_TICK_MS ?? 2_000),
  payoutTickMs: Number(process.env.ENGINE_PAYOUT_TICK_MS ?? 4_000),
  balanceTickMs: Number(process.env.ENGINE_BALANCE_TICK_MS ?? 10_000),
  depositTickMs: Number(process.env.ENGINE_DEPOSIT_TICK_MS ?? 3_000),
  /** Mining cycles (the original free-energy game). Off: the accelerator runs instant bets. */
  enableCycles: process.env.ENGINE_CYCLES === "true",
  /** A closed cycle whose entropy block still cannot be read after this long is voided. */
  voidAfterMs: Number(process.env.ENGINE_VOID_AFTER_MS ?? 60 * 60_000),
  /** Safety cap in whole $TUNNEL: larger payouts wait for an operator (docs/SECURITY.md). */
  maxPayoutTokens: BigInt(process.env.ENGINE_MAX_PAYOUT_TOKENS ?? "1000000"),
  /** Keep at least this much SOL for fees; payouts wait below it. */
  minFeeLamports: BigInt(process.env.ENGINE_MIN_FEE_LAMPORTS ?? "20000000"),
  healthPort: Number(process.env.PORT ?? process.env.ENGINE_HEALTH_PORT ?? 8787),
};
