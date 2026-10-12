/**
 * TUNNEL engine: the only process that runs cycles and holds a key.
 *   - cycle loop: close → settle (blockhash entropy) → open
 *   - payout loop: send requested payouts, reconcile in-flight ones
 *   - balance loop: publish the reward wallet's on-chain balances
 */
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, type PublicKey } from "@solana/web3.js";
import { ensureConfig } from "@tunnel/core";
import { getDb } from "@tunnel/db";
import { createServer } from "node:http";
import { config } from "./config";
import { cycleTick } from "./cycles";
import { scanDeposits } from "./deposits";
import { log } from "./log";
import { reconcileSending, resolveTokenProgram, sendRequested, type PayoutContext } from "./payouts";

const conn = new Connection(config.rpcUrl, "confirmed");
const db = getDb();
const health = { startedAt: new Date().toISOString(), lastCycleTick: 0, lastPayoutTick: 0, lastError: null as string | null, cycle: "" };

let stopping = false;
const loops: Promise<void>[] = [];

/** Runs `fn` every `ms` until shutdown; errors are logged and the loop continues. */
function every(name: string, ms: number, fn: () => Promise<void>) {
  loops.push(
    (async () => {
      while (!stopping) {
        const t = Date.now();
        try {
          await fn();
        } catch (e) {
          health.lastError = `${name}: ${String(e)}`;
          log.error({ loop: name, err: String(e) }, "loop iteration failed");
        }
        await new Promise((r) => setTimeout(r, Math.max(0, ms - (Date.now() - t))));
      }
    })(),
  );
}

async function main() {
  await ensureConfig(db);
  log.info({ rpc: config.rpcUrl, rewardWallet: config.rewardWallet?.publicKey.toBase58() ?? null, mint: config.tunnelMint?.toBase58() ?? null }, "engine starting");

  if (config.enableCycles) {
    every("cycles", config.tickMs, async () => {
      const r = await cycleTick(conn, db, config.voidAfterMs);
      health.lastCycleTick = Date.now();
      health.cycle = r.open;
    });
  } else {
    // Liveness for the web app (and the latest slot) without running mining cycles.
    every("heartbeat", config.tickMs, async () => {
      const slot = BigInt(await conn.getSlot("confirmed"));
      await db.protocolConfig.update({ where: { id: 1 }, data: { lastSlot: slot, engineHeartbeat: new Date() } });
      health.lastCycleTick = Date.now();
    });
  }

  if (!config.rewardWallet || !config.tunnelMint) {
    log.warn("REWARD_WALLET_KEYPAIR or TUNNEL_MINT not set: payouts disabled (claims will queue)");
  } else {
    const tokenProgram = await resolveTokenProgram(conn, config.tunnelMint);
    const ctx: PayoutContext = {
      conn,
      db,
      wallet: config.rewardWallet,
      mint: config.tunnelMint,
      tokenProgram,
      maxPayoutTokens: config.maxPayoutTokens,
      minFeeLamports: config.minFeeLamports,
    };
    await db.protocolConfig.update({ where: { id: 1 }, data: { rewardWallet: ctx.wallet.publicKey.toBase58(), tunnelMint: ctx.mint.toBase58() } });
    every("payouts", config.payoutTickMs, async () => {
      await reconcileSending(ctx);
      await sendRequested(ctx);
      health.lastPayoutTick = Date.now();
    });
    every("balances", config.balanceTickMs, () => publishBalances(ctx.wallet.publicKey, ctx.mint, tokenProgram));
    every("deposits", config.depositTickMs, () => scanDeposits({ conn, db, house: ctx.wallet.publicKey, mint: ctx.mint, tokenProgram }));
  }

  createServer((req, res) => {
    const stale = Date.now() - health.lastCycleTick > Math.max(30_000, config.tickMs * 10);
    res.writeHead(stale ? 503 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: !stale, ...health }));
  }).listen(config.healthPort, () => log.info({ port: config.healthPort }, "health endpoint up"));
}

async function publishBalances(wallet: PublicKey, mint: PublicKey, tokenProgram: PublicKey) {
  const ata = getAssociatedTokenAddressSync(mint, wallet, false, tokenProgram);
  const [lamports, tokens] = await Promise.all([
    conn.getBalance(wallet, "confirmed"),
    conn.getTokenAccountBalance(ata, "confirmed").then((b) => BigInt(b.value.amount)).catch(() => 0n),
  ]);
  await db.protocolConfig.update({ where: { id: 1 }, data: { rewardWalletLamports: BigInt(lamports), rewardWalletTokens: tokens } });
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    log.info({ sig }, "shutting down");
    stopping = true;
    await Promise.allSettled(loops);
    await db.$disconnect();
    process.exit(0);
  });
}

main().catch((e) => {
  log.fatal({ err: String(e) }, "engine failed to start");
  process.exit(1);
});
