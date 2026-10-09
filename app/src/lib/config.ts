import { PublicKey } from "@solana/web3.js";
import { TUNNEL_PROGRAM_ID } from "@tunnel/sdk";

export type Cluster = "localnet" | "devnet" | "mainnet-beta";

const cluster = (process.env.NEXT_PUBLIC_CLUSTER ?? "devnet") as Cluster;

export const appConfig = {
  cluster,
  rpcUrl:
    process.env.NEXT_PUBLIC_RPC_URL ??
    (cluster === "localnet" ? "http://127.0.0.1:8899" : cluster === "mainnet-beta" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com"),
  programId: process.env.NEXT_PUBLIC_TUNNEL_PROGRAM_ID ? new PublicKey(process.env.NEXT_PUBLIC_TUNNEL_PROGRAM_ID) : TUNNEL_PROGRAM_ID,
  /**
   * Deposits are hard-disabled on mainnet unless explicitly enabled by the
   * operator. Devnet SOL has no monetary value.
   */
  depositsEnabled: cluster !== "mainnet-beta" || process.env.NEXT_PUBLIC_MAINNET_DEPOSITS_ENABLED === "true",
};

export const clusterLabel: Record<Cluster, string> = {
  localnet: "Localnet",
  devnet: "Devnet",
  "mainnet-beta": "Mainnet",
};

export function explorerTx(sig: string) {
  return `https://explorer.solana.com/tx/${sig}${clusterQuery()}`;
}

export function explorerAddress(address: string) {
  return `https://explorer.solana.com/address/${address}${clusterQuery()}`;
}

function clusterQuery() {
  if (cluster === "mainnet-beta") return "";
  if (cluster === "localnet") return `?cluster=custom&customUrl=${encodeURIComponent(appConfig.rpcUrl)}`;
  return `?cluster=${cluster}`;
}
