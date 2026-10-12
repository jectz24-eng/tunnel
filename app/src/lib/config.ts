export type Cluster = "localnet" | "devnet" | "mainnet-beta";

const cluster = (process.env.NEXT_PUBLIC_CLUSTER ?? "mainnet-beta") as Cluster;

export const appConfig = {
  cluster,
  rpcUrl:
    process.env.NEXT_PUBLIC_RPC_URL ??
    (cluster === "localnet" ? "http://127.0.0.1:8899" : cluster === "mainnet-beta" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com"),
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

export function explorerBlock(slot: bigint | number) {
  return `https://explorer.solana.com/block/${slot}${clusterQuery()}`;
}

function clusterQuery() {
  if (cluster === "mainnet-beta") return "";
  if (cluster === "localnet") return `?cluster=custom&customUrl=${encodeURIComponent(appConfig.rpcUrl)}`;
  return `?cluster=${cluster}`;
}
