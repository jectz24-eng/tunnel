import "dotenv/config";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TUNNEL_PROGRAM_ID } from "@tunnel/sdk";
import { existsSync, readFileSync } from "node:fs";

function keypair(path: string | undefined): Keypair | null {
  if (!path) return null;
  if (!existsSync(path)) throw new Error(`KEEPER_KEYPAIR not found: ${path}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

export const config = {
  rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
  wsUrl: process.env.SOLANA_WS_URL,
  programId: process.env.TUNNEL_PROGRAM_ID ? new PublicKey(process.env.TUNNEL_PROGRAM_ID) : TUNNEL_PROGRAM_ID,
  /** Pays rent for new rounds and ORAO request fees. Never holds user funds. */
  keeper: keypair(process.env.KEEPER_KEYPAIR),
  enableCrank: process.env.KEEPER_ENABLE_CRANK !== "false",
  enableIndexer: process.env.KEEPER_ENABLE_INDEXER !== "false",
  crankIntervalMs: Number(process.env.KEEPER_CRANK_INTERVAL_MS ?? 2_000),
  reconcileIntervalMs: Number(process.env.KEEPER_RECONCILE_INTERVAL_MS ?? 5_000),
  backfillIntervalMs: Number(process.env.KEEPER_BACKFILL_INTERVAL_MS ?? 15_000),
  settleBatchSize: Number(process.env.KEEPER_SETTLE_BATCH ?? 4),
  healthPort: Number(process.env.KEEPER_HEALTH_PORT ?? 8787),
  /** How many recent round ids the crank and reconciler re-scan from chain. */
  scanWindow: Number(process.env.KEEPER_SCAN_WINDOW ?? 120),
};
