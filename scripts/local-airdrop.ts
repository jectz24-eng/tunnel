/**
 * LOCALNET ONLY: give a wallet local test SOL, and optionally local $TUNNEL from the operator.
 *   SOLANA_RPC_URL=http://127.0.0.1:8899 npx tsx scripts/local-airdrop.ts <address> [sol=50] [tunnel=0]
 */
import { getOrCreateAssociatedTokenAccount, transferChecked } from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { TUNNEL_DECIMALS, TUNNEL_UNIT } from "../packages/sdk/src";
import { localKey } from "./local-setup";
import { connection, guardCluster, readDeployment } from "./lib";

const [address, amount = "50", tunnel = "0"] = process.argv.slice(2);
if (!address) throw new Error("usage: local-airdrop.ts <address> [sol] [tunnel]");
const conn = connection();
if ((await guardCluster(conn)) !== "localnet") throw new Error("local-airdrop only works on a local validator");
const to = new PublicKey(address);
if (Number(amount) > 0) {
  const sig = await conn.requestAirdrop(to, Number(amount) * LAMPORTS_PER_SOL);
  await conn.confirmTransaction({ signature: sig, ...(await conn.getLatestBlockhash()) }, "confirmed");
}
if (Number(tunnel) > 0) {
  const mintAddr = readDeployment("localnet").tunnelMint;
  if (!mintAddr) throw new Error("no local $TUNNEL mint: run scripts/local-setup.ts first");
  const operator = localKey("operator");
  const mint = new PublicKey(mintAddr);
  const from = await getOrCreateAssociatedTokenAccount(conn, operator, mint, operator.publicKey);
  const dest = await getOrCreateAssociatedTokenAccount(conn, operator, mint, to);
  await transferChecked(conn, operator, from.address, mint, dest.address, operator, BigInt(tunnel) * TUNNEL_UNIT, TUNNEL_DECIMALS);
}
console.log(`sent ${amount} local SOL and ${tunnel} local $TUNNEL to ${address}; balance ${(await conn.getBalance(to)) / LAMPORTS_PER_SOL} SOL`);
process.exit(0);
