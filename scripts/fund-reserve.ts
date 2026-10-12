/**
 * Moves $TUNNEL from the operator wallet into the engine's reward wallet and
 * records it as mining reserve (cycles never budget more than what is recorded).
 *
 *   npm run setup:fund -- --reward-wallet <address> --amount 600000000   # whole $TUNNEL
 *   (mainnet additionally needs --confirm-mainnet)
 *
 * Env: SOLANA_RPC_URL, KEYPAIR_PATH (operator, holds the tokens), DATABASE_URL, TUNNEL_MINT.
 */
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { recordReserveFunding } from "../packages/core/src";
import { getDb } from "../packages/db/src";
import { TUNNEL_DECIMALS, TUNNEL_UNIT, formatTunnel } from "../packages/sdk/src";
import { arg, connection, explorer, guardCluster, loadKeypair, readDeployment, sendIxs } from "./lib";

async function main() {
  const conn = connection();
  const cluster = await guardCluster(conn);
  const operator = loadKeypair();
  const mintAddr = process.env.TUNNEL_MINT ?? readDeployment(cluster).tunnelMint;
  const to = arg("reward-wallet") ?? readDeployment(cluster).rewardWallet;
  const whole = arg("amount");
  if (!mintAddr || !to || !whole || !/^\d+$/.test(whole)) throw new Error("need TUNNEL_MINT, --reward-wallet <address> and --amount <whole $TUNNEL>");
  const mint = new PublicKey(mintAddr);
  const owner = new PublicKey(to);
  const amount = BigInt(whole) * TUNNEL_UNIT;
  const tokenProgram = (await conn.getAccountInfo(mint))?.owner;
  if (!tokenProgram) throw new Error("mint not found");

  const from = getAssociatedTokenAddressSync(mint, operator.publicKey, false, tokenProgram);
  const dest = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
  const sig = await sendIxs(conn, operator, [
    createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, dest, owner, mint, tokenProgram),
    createTransferCheckedInstruction(from, mint, dest, operator.publicKey, amount, TUNNEL_DECIMALS, [], tokenProgram),
  ]);
  console.log(`sent ${formatTunnel(amount)} $TUNNEL to reward wallet ${to}\n  ${explorer(sig, cluster)}`);

  await recordReserveFunding(getDb(), amount, sig, operator.publicKey.toBase58());
  console.log("recorded as mining reserve");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
