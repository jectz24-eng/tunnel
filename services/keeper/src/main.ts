import { Connection } from "@solana/web3.js";
import { getDb, hasDatabase } from "@tunnel/db";
import { createServer } from "node:http";
import { config } from "./config";
import { Crank } from "./crank";
import { Indexer } from "./indexer";
import { log } from "./log";
import { Reconciler } from "./reconciler";

const connection = new Connection(config.rpcUrl, { commitment: "confirmed", wsEndpoint: config.wsUrl });
const db = hasDatabase() ? getDb() : null;
const health = { startedAt: new Date().toISOString(), indexer: { lastBackfill: 0, lastReconcile: 0, lastError: null as string | null } };

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
          log.error({ loop: name, err: String(e) }, "loop iteration failed");
          if (name !== "crank") health.indexer.lastError = `${name}: ${String(e)}`;
        }
        await new Promise((r) => setTimeout(r, Math.max(0, ms - (Date.now() - t))));
      }
    })(),
  );
}

async function main() {
  log.info({ rpc: config.rpcUrl, program: config.programId.toBase58(), db: !!db }, "keeper starting");

  let crank: Crank | null = null;
  if (config.enableCrank) {
    if (!config.keeper) {
      log.warn("KEEPER_KEYPAIR not set — crank disabled (indexer only)");
    } else {
      crank = new Crank(connection, db, config.keeper, config.programId, config.scanWindow, config.settleBatchSize);
      every("crank", config.crankIntervalMs, () => crank!.tick());
    }
  }

  if (config.enableIndexer) {
    if (!db) throw new Error("DATABASE_URL is required for the indexer");
    const reconciler = new Reconciler(connection, db, config.programId, config.scanWindow);
    const indexer = new Indexer(connection, db, config.programId, reconciler.touch);
    await indexer.backfill(); // catch up on anything missed while down
    indexer.startLive();
    every("backfill", config.backfillIntervalMs, async () => {
      await indexer.backfill();
      await indexer.fillBlockTimes();
      await indexer.reconcileFinality();
      health.indexer.lastBackfill = Date.now();
    });
    every("reconcile", config.reconcileIntervalMs, async () => {
      await reconciler.run();
      health.indexer.lastReconcile = Date.now();
    });
    process.once("SIGTERM", () => void indexer.stopLive());
  }

  createServer((req, res) => {
    const body = {
      ok: true,
      ...health,
      crank: crank ? { lastTickAt: crank.lastTickAt, lastError: crank.lastError } : null,
    };
    const stale = crank && Date.now() - crank.lastTickAt > 60_000;
    res.writeHead(req.url === "/health" && stale ? 503 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }).listen(config.healthPort, () => log.info({ port: config.healthPort }, "health endpoint up"));
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, async () => {
    log.info({ sig }, "shutting down");
    stopping = true;
    await Promise.race([Promise.all(loops), new Promise((r) => setTimeout(r, 5_000))]);
    process.exit(0);
  });
}

main().catch((e) => {
  log.fatal({ err: String(e) }, "keeper failed to start");
  process.exit(1);
});
