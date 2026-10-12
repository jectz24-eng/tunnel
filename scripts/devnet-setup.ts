/**
 * DEVNET bootstrap for a full real-network test. Needs keys/devnet-operator.json
 * funded with ~1 devnet SOL (https://faucet.solana.com).
 *   - sends fee SOL to keys/devnet-reward-wallet.json and keys/devnet-player.json
 *   - creates $TUNNEL (placeholder supply) and moves the vault reserve to the reward wallet
 *   - gives the test player 1,000 $TUNNEL, records the reserve and opens betting
 *
 *   SOLANA_RPC_URL=https://api.devnet.solana.com DATABASE_URL=... npx tsx scripts/devnet-setup.ts
 */
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, transferChecked } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { ensureConfig, recordReserveFunding, setBetLimits, setPaused } from "../packages/core/src";
import { getDb } from "../packages/db/src";
import { PLACEHOLDER_TOKENOMICS, TUNNEL_DECIMALS, TUNNEL_UNIT } from "../packages/sdk/src";
import { connection, guardCluster, readDeployment, writeDeployment } from "./lib";

const key = (name: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`keys/devnet-${name}.json`, "utf8"))));

async function main() {
  const conn = connection();
  if ((await guardCluster(conn)) !== "devnet") throw new Error("devnet-setup only runs against devnet");
  const db = getDb();
  await ensureConfig(db);
  const operator = key("operator");
  const reward = key("reward-wallet");
  const player = key("player");
  const sol = await conn.getBalance(operator.publicKey);
  if (sol < 0.6 * LAMPORTS_PER_SOL) throw new Error(`operator ${operator.publicKey.toBase58()} has ${sol / LAMPORTS_PER_SOL} SOL; fund it with ~1 devnet SOL first`);

  const top = async (to: PublicKey, lamports: number) => {
    if ((await conn.getBalance(to)) >= lamports) return;
    await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: operator.publicKey, toPubkey: to, lamports })), [operator]);
  };
  await top(reward.publicKey, 0.25 * LAMPORTS_PER_SOL);
  await top(player.publicKey, 0.1 * LAMPORTS_PER_SOL);
  console.log(`fee SOL sent: reward wallet ${reward.publicKey.toBase58()}, player ${player.publicKey.toBase58()}`);

  let mintAddr = readDeployment("devnet").tunnelMint;
  if (!mintAddr || !(await conn.getAccountInfo(new PublicKey(mintAddr)))) {
    const mint = await createMint(conn, operator, operator.publicKey, null, TUNNEL_DECIMALS);
    const from = await getOrCreateAssociatedTokenAccount(conn, operator, mint, operator.publicKey);
    await mintTo(conn, operator, mint, from.address, operator, PLACEHOLDER_TOKENOMICS.totalSupply);
    const vault = await getOrCreateAssociatedTokenAccount(conn, operator, mint, reward.publicKey);
    const sig = await transferChecked(conn, operator, from.address, mint, vault.address, operator, PLACEHOLDER_TOKENOMICS.miningReserve, TUNNEL_DECIMALS);
    await recordReserveFunding(db, PLACEHOLDER_TOKENOMICS.miningReserve, sig, operator.publicKey.toBase58());
    const pl = await getOrCreateAssociatedTokenAccount(conn, operator, mint, player.publicKey);
    await transferChecked(conn, operator, from.address, mint, pl.address, operator, 1_000n * TUNNEL_UNIT, TUNNEL_DECIMALS);
    mintAddr = mint.toBase58();
    writeDeployment("devnet", { tunnelMint: mintAddr, rewardWallet: reward.publicKey.toBase58(), operator: operator.publicKey.toBase58() });
    console.log(`$TUNNEL mint ${mintAddr}; vault funded; player has 1,000 $TUNNEL`);
  }
  await setPaused(db, true, "devnet-setup"); // mining cycles off: the accelerator is the product
  await setBetLimits(db, { bettingPaused: false }, "devnet-setup");
  console.log(`\nengine env:\n  REWARD_WALLET_KEYPAIR=keys/devnet-reward-wallet.json\n  TUNNEL_MINT=${mintAddr}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
