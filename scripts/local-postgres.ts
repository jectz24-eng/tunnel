/**
 * Zero-install local PostgreSQL for development: runs PGlite (Postgres compiled
 * to WASM) behind the Postgres wire protocol on 127.0.0.1:5432, persisting to
 * ~/.tunnel/pgdata (outside the repo, so the dev server does not rebuild on
 * every write). Prisma, the engine and the app connect to it like any Postgres.
 * Set DATABASE_POOL_MAX=1 for clients: PGlite runs one query at a time.
 * Production uses a real managed PostgreSQL (see docs/DEPLOYMENT.md).
 *
 *   npm run db:local
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { homedir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.PGPORT ?? 5432);
const dir = process.env.PGLITE_DIR ?? join(homedir(), ".tunnel", "pgdata");
const db = await PGlite.create(dir);
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 64 });
await server.start();
console.log(`local postgres (PGlite) listening on 127.0.0.1:${port} — data in ${dir}`);

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
