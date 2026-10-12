/**
 * TUNNEL engine: the only process that runs cycles and holds a key.
 *   - cycle loop: close → settle (blockhash entropy) → open
 *   - payout loop: send requested payouts, reconcile in-flight ones
 *   - balance loop: publish the reward wallet's on-chain balances
 */
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { ensureConfig } from "@tunnel/core";
import { getDb } from "@tunnel/db";
import { createServer } from "node:http";
import { config } from "./config";
import { cycleTick } from "./cycles";
import { scanDeposits } from "./deposits";
import { log } from "./log";
import { reconcileSending, resolveTokenProgram, sendRequested, type PayoutContext } from "./payouts";

let conn: Connection;
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

/** RPC and mint: env vars pin them, otherwise the settings saved from /admin. */
async function settings() {
  const c = await db.protocolConfig.findUnique({ where: { id: 1 }, select: { engineRpcUrl: true, tunnelMint: true } });
  return {
    rpcUrl: config.rpcUrl ?? c?.engineRpcUrl ?? config.defaultRpcUrl,
    mint: config.tunnelMint ?? (c?.tunnelMint ? new PublicKey(c.tunnelMint) : null),
  };
}

async function main() {
  // Bind the health port first: hosts such as Render wait for an open port before marking a deploy live.
  createServer((req, res) => {
    const stale = Date.now() - health.lastCycleTick > Math.max(30_000, config.tickMs * 10);
    res.writeHead(stale ? 503 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: !stale, ...health }));
  }).listen(config.healthPort, () => log.info({ port: config.healthPort }, "health endpoint up"));

  await ensureConfig(db);
  const active = await settings();
  conn = new Connection(active.rpcUrl, "confirmed");
  log.info({ rpc: new URL(active.rpcUrl).origin, rewardWallet: config.rewardWallet?.publicKey.toBase58() ?? null, mint: active.mint?.toBase58() ?? null }, "engine starting");

  // A changed RPC or mint needs fresh connections and payout context: exit and let the host restart the engine.
  every("settings", config.settingsTickMs, async () => {
    const now = await settings();
    if (now.rpcUrl !== active.rpcUrl || now.mint?.toBase58() !== active.mint?.toBase58()) void shutdown("settings changed in /admin; restarting to apply");
  });

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

  if (!config.rewardWallet || !active.mint) {
    log.warn("REWARD_WALLET_KEYPAIR or the $TUNNEL mint (/admin or TUNNEL_MINT) not set: payouts disabled (claims will queue)");
  } else {
    const tokenProgram = await resolveTokenProgram(conn, active.mint);
    const ctx: PayoutContext = {
      conn,
      db,
      wallet: config.rewardWallet,
      mint: active.mint,
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
}

async function publishBalances(wallet: PublicKey, mint: PublicKey, tokenProgram: PublicKey) {
  const ata = getAssociatedTokenAddressSync(mint, wallet, false, tokenProgram);
  const [lamports, tokens] = await Promise.all([
    conn.getBalance(wallet, "confirmed"),
    conn.getTokenAccountBalance(ata, "confirmed").then((b) => BigInt(b.value.amount)).catch(() => 0n),
  ]);
  await db.protocolConfig.update({ where: { id: 1 }, data: { rewardWalletLamports: BigInt(lamports), rewardWalletTokens: tokens } });
}

async function shutdown(reason: string) {
  if (stopping) return;
  log.info({ reason }, "shutting down");
  stopping = true;
  await Promise.allSettled(loops);
  await db.$disconnect();
  process.exit(0);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => void shutdown(sig));

main().catch((e) => {
  log.fatal({ err: String(e) }, "engine failed to start");
  process.exit(1);
});
