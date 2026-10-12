/**
 * One-shot LOCALNET bootstrap (a plain `solana-test-validator` must be running):
 *   - creates keys/localnet-{operator,reward-wallet}.json and airdrops local SOL
 *   - creates $TUNNEL (placeholder supply) and moves the placeholder reserve to the reward wallet
 *   - records the reserve, sets the cycle length, and resumes mining in the database
 *
 *   SOLANA_RPC_URL=http://127.0.0.1:8899 DATABASE_URL=... npx tsx scripts/local-setup.ts [--cycle-secs 120]
 *
 * Then run the engine with REWARD_WALLET_KEYPAIR=keys/localnet-reward-wallet.json and TUNNEL_MINT=<printed mint>.
 */
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, transferChecked } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, type Connection } from "@solana/web3.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureConfig, loadConfig, recordReserveFunding, setParams, setPaused } from "../packages/core/src";
import { getDb } from "../packages/db/src";
import { PLACEHOLDER_TOKENOMICS, TUNNEL_DECIMALS } from "../packages/sdk/src";
import { ROOT, arg, connection, guardCluster, readDeployment, writeDeployment } from "./lib";

export function localKey(name: string): Keypair {
  const dir = join(ROOT, "keys");
  const p = join(dir, `localnet-${name}.json`);
  if (!existsSync(p)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(p, JSON.stringify(Array.from(Keypair.generate().secretKey)));
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

async function airdrop(conn: Connection, to: PublicKey, sol: number) {
  const sig = await conn.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  await conn.confirmTransaction({ signature: sig, ...(await conn.getLatestBlockhash()) }, "confirmed");
}

async function main() {
  const conn = connection();
  if ((await guardCluster(conn)) !== "localnet") throw new Error("local-setup only runs against a local validator");
  const db = getDb();
  await ensureConfig(db);
  const operator = localKey("operator");
  const reward = localKey("reward-wallet");
  for (const k of [operator, reward]) await airdrop(conn, k.publicKey, 20);
  console.log(`operator ${operator.publicKey.toBase58()} · reward wallet ${reward.publicKey.toBase58()}`);

  let mintAddr = readDeployment("localnet").tunnelMint;
  if (!mintAddr || !readDeployment("localnet").rewardWallet || !(await conn.getAccountInfo(new PublicKey(mintAddr)))) {
    const mint = await createMint(conn, operator, operator.publicKey, null, TUNNEL_DECIMALS);
    const from = await getOrCreateAssociatedTokenAccount(conn, operator, mint, operator.publicKey);
    await mintTo(conn, operator, mint, from.address, operator, PLACEHOLDER_TOKENOMICS.totalSupply);
    const to = await getOrCreateAssociatedTokenAccount(conn, operator, mint, reward.publicKey);
    const sig = await transferChecked(conn, operator, from.address, mint, to.address, operator, PLACEHOLDER_TOKENOMICS.miningReserve, TUNNEL_DECIMALS);
    await recordReserveFunding(db, PLACEHOLDER_TOKENOMICS.miningReserve, sig, operator.publicKey.toBase58());
    mintAddr = mint.toBase58();
    writeDeployment("localnet", { tunnelMint: mintAddr, rewardWallet: reward.publicKey.toBase58(), operator: operator.publicKey.toBase58() });
    console.log(`$TUNNEL mint ${mintAddr}; placeholder reserve moved to the reward wallet and recorded`);
  }

  const cfg = await loadConfig(db);
  await setParams(db, { ...cfg.params, cycleDurationSecs: Number(arg("cycle-secs") ?? 120) }, "local-setup");
  await setPaused(db, false, "local-setup");
  console.log(`\nengine env:\n  REWARD_WALLET_KEYPAIR=${join(ROOT, "keys", "localnet-reward-wallet.json")}\n  TUNNEL_MINT=${mintAddr}`);
  process.exit(0);
}

if (process.argv[1]?.endsWith("local-setup.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
