import "dotenv/config";
import { Connection, Keypair, Transaction, sendAndConfirmTransaction, type TransactionInstruction } from "@solana/web3.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..");

const GENESIS = {
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": "mainnet-beta",
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: "devnet",
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY": "testnet",
} as Record<string, string>;

export function connection() {
  const url = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  return new Connection(url, "confirmed");
}

/**
 * Identifies the cluster by genesis hash (not by URL, which can lie) and
 * refuses to touch mainnet unless the operator has explicitly authorised it.
 */
export async function guardCluster(conn: Connection): Promise<string> {
  const genesis = await conn.getGenesisHash();
  const cluster = GENESIS[genesis] ?? "localnet";
  if (cluster === "mainnet-beta") {
    const authorised =
      process.env.TUNNEL_MAINNET_AUTHORIZED === "I_HAVE_OWNER_APPROVAL_AND_AN_INDEPENDENT_AUDIT" &&
      process.argv.includes("--confirm-mainnet");
    if (!authorised) {
      throw new Error(
        "Refusing to run against mainnet-beta. Mainnet requires explicit owner authorization and an " +
          "independent security audit (docs/DEPLOYMENT.md §Mainnet).",
      );
    }
  }
  console.log(`cluster: ${cluster} (${conn.rpcEndpoint})`);
  return cluster;
}

export function loadKeypair(path = process.env.KEYPAIR_PATH ?? join(homedir(), ".config", "solana", "id.json")): Keypair {
  const p = path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
  if (!existsSync(p)) throw new Error(`keypair not found at ${p} (set KEYPAIR_PATH)`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

export async function sendIxs(conn: Connection, payer: Keypair, ixs: TransactionInstruction[], extra: Keypair[] = []) {
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [payer, ...extra], { commitment: "confirmed" });
  return sig;
}

export function explorer(sig: string, cluster: string) {
  const c = cluster === "mainnet-beta" ? "" : cluster === "localnet" ? "?cluster=custom" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${sig}${c}`;
}

/** Deployment record (addresses only — never secrets) for app/keeper config. */
export function deploymentPath(cluster: string) {
  return join(ROOT, "deployments", `${cluster}.json`);
}

export function readDeployment(cluster: string): Record<string, string> {
  const p = deploymentPath(cluster);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
}

export function writeDeployment(cluster: string, patch: Record<string, string>) {
  const p = deploymentPath(cluster);
  mkdirSync(dirname(p), { recursive: true });
  const next = { ...readDeployment(cluster), ...patch, updatedAt: new Date().toISOString() };
  writeFileSync(p, JSON.stringify(next, null, 2) + "\n");
  return next;
}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
