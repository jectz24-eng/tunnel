/**
 * TUNNEL engine: the only process that runs cycles and holds a key.
 *   - cycle loop: close → settle (blockhash entropy) → open
 *   - payout loop: send requested payouts, reconcile in-flight ones
 *   - balance loop: publish the reward wallet's on-chain balances
 */
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey, type Keypair } from "@solana/web3.js";
import { ensureConfig } from "@tunnel/core";
import { getDb } from "@tunnel/db";
import { createServer } from "node:http";
import { config } from "./config";
import { cycleTick } from "./cycles";
import { scanDeposits } from "./deposits";
import { log } from "./log";
import { reconcileSending, resolveTokenProgram, sendRequested, type PayoutContext } from "./payouts";
import { openSealedWallet, sealKeyPair } from "./sealed";

let conn: Connection;
const db = getDb();
const sealBox = sealKeyPair(config.sealSecret);
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

/** RPC, mint and reward wallet: env vars / the keypair file pin them, otherwise the settings saved from /admin. */
async function settings() {
  const c = await db.protocolConfig.findUnique({
    where: { id: 1 },
    select: { engineRpcUrl: true, tunnelMint: true, sealedRewardWallet: true, sealedRewardWalletAddress: true },
  });
  return {
    rpcUrl: config.rpcUrl ?? c?.engineRpcUrl ?? config.defaultRpcUrl,
    mint: config.tunnelMint ?? (c?.tunnelMint ? new PublicKey(c.tunnelMint) : null),
    sealed: config.rewardWallet ? null : (c?.sealedRewardWallet ?? null),
    sealedAddress: c?.sealedRewardWalletAddress ?? null,
  };
}

function rewardWallet(s: Awaited<ReturnType<typeof settings>>): Keypair | null {
  if (config.rewardWallet) return config.rewardWallet;
  if (!s.sealed) return null;
  if (!sealBox) {
    log.error("a reward wallet is set in /admin but ENGINE_SEAL_SECRET is missing; payouts stay off");
    return null;
  }
  try {
    return openSealedWallet(s.sealed, s.sealedAddress, sealBox);
  } catch (e) {
    health.lastError = String(e);
    log.error({ err: String(e) }, "cannot use the reward wallet set in /admin; payouts stay off");
    return null;
  }
}

async function main() {
  // Bind the health port first: hosts such as Render wait for an open port before marking a deploy live.
  createServer((req, res) => {
    const stale = Date.now() - health.lastCycleTick > Math.max(30_000, config.tickMs * 10);
    res.writeHead(stale ? 503 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: !stale, ...health }));
  }).listen(config.healthPort, () => log.info({ port: config.healthPort }, "health endpoint up"));

  await ensureConfig(db);
  // /admin seals the reward-wallet key to this public key.
  await db.protocolConfig.update({ where: { id: 1 }, data: { sealPublicKey: sealBox ? Buffer.from(sealBox.publicKey).toString("base64") : null } });
  const active = await settings();
  conn = new Connection(active.rpcUrl, "confirmed");
  const wallet = rewardWallet(active);
  log.info({ rpc: new URL(active.rpcUrl).origin, rewardWallet: wallet?.publicKey.toBase58() ?? null, mint: active.mint?.toBase58() ?? null }, "engine starting");

  // A changed RPC, mint or reward wallet needs fresh connections and payout context: exit and let the host restart the engine.
  every("settings", config.settingsTickMs, async () => {
    const now = await settings();
    if (now.rpcUrl !== active.rpcUrl || now.mint?.toBase58() !== active.mint?.toBase58() || now.sealed !== active.sealed) {
      void shutdown("settings changed in /admin; restarting to apply");
    }
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

  if (!wallet || !active.mint) {
    log.warn("reward wallet (/admin or REWARD_WALLET_KEYPAIR) or $TUNNEL mint (/admin or TUNNEL_MINT) not set: payouts disabled (claims will queue)");
  } else {
    const tokenProgram = await resolveTokenProgram(conn, active.mint);
    const ctx: PayoutContext = {
      conn,
      db,
      wallet,
      mint: active.mint,
      tokenProgram,
      maxPayoutTokens: config.maxPayoutTokens,
      minFeeLamports: config.minFeeLamports,
    };
    const address = wallet.publicKey.toBase58();
    const prior = await db.protocolConfig.findUnique({ where: { id: 1 }, select: { rewardWallet: true } });
    const data: { rewardWallet: string; tunnelMint: string; depositCursor?: string | null } = { rewardWallet: address, tunnelMint: ctx.mint.toBase58() };
    if (prior?.rewardWallet && prior.rewardWallet !== address) {
      // New vault: the deposit cursor belonged to the old one. Start from the new account's latest
      // transaction so its earlier history is never credited as player deposits.
      const ata = getAssociatedTokenAddressSync(ctx.mint, wallet.publicKey, false, tokenProgram);
      data.depositCursor = (await conn.getSignaturesForAddress(ata, { limit: 1 }, "finalized"))[0]?.signature ?? null;
      log.warn({ from: prior.rewardWallet, to: address }, "reward wallet changed; deposit scanning restarts from now");
    }
    await db.protocolConfig.update({ where: { id: 1 }, data });
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
