/**
 * LOCALNET ONLY: give a wallet local test SOL.
 *   SOLANA_RPC_URL=http://127.0.0.1:8899 npx tsx scripts/local-airdrop.ts <address> [sol=50]
 */
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { connection, guardCluster } from "./lib";

const [address, amount = "50"] = process.argv.slice(2);
if (!address) throw new Error("usage: local-airdrop.ts <address> [sol]");
const conn = connection();
if ((await guardCluster(conn)) !== "localnet") throw new Error("local-airdrop only works on a local validator");
const sig = await conn.requestAirdrop(new PublicKey(address), Number(amount) * LAMPORTS_PER_SOL);
await conn.confirmTransaction({ signature: sig, ...(await conn.getLatestBlockhash()) }, "confirmed");
console.log(`sent ${amount} local SOL to ${address}; balance ${(await conn.getBalance(new PublicKey(address))) / LAMPORTS_PER_SOL} SOL`);
