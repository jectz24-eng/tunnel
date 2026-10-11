import "server-only";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TUNNEL_PROGRAM_ID, fetchProtocol } from "@tunnel/sdk";
import { existsSync, readFileSync } from "node:fs";

let conn: Connection | null = null;

/** Server-side RPC connection (SOLANA_RPC_URL, else the public app RPC). */
export function serverConnection() {
  conn ??= new Connection(
    process.env.SOLANA_RPC_URL ??
      process.env.NEXT_PUBLIC_RPC_URL ??
      (process.env.NEXT_PUBLIC_CLUSTER === "localnet" ? "http://127.0.0.1:8899" : "https://api.devnet.solana.com"),
    "confirmed",
  );
  return conn;
}

export const serverProgramId = () => (process.env.NEXT_PUBLIC_TUNNEL_PROGRAM_ID ? new PublicKey(process.env.NEXT_PUBLIC_TUNNEL_PROGRAM_ID) : TUNNEL_PROGRAM_ID);

let protocolCache: { at: number; value: Awaited<ReturnType<typeof fetchProtocol>> } | null = null;

/** The onchain Protocol account, cached for a few seconds. */
export async function serverProtocol() {
  if (!protocolCache || Date.now() - protocolCache.at > 5_000) {
    protocolCache = { at: Date.now(), value: await fetchProtocol(serverConnection(), serverProgramId()) };
  }
  return protocolCache.value;
}

let gatekeeper: Keypair | null | undefined;

/**
 * The gatekeeper (deployment co-signer) key, from GATEKEEPER_KEYPAIR (a path
 * to a keypair JSON file). It only authorises deployments; it controls no
 * funds or rewards. null when not configured.
 */
export function gatekeeperKeypair(): Keypair | null {
  if (gatekeeper !== undefined) return gatekeeper;
  const path = process.env.GATEKEEPER_KEYPAIR;
  gatekeeper = path && existsSync(path) ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")))) : null;
  return gatekeeper;
}
