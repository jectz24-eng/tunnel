/**
 * Zero-install local PostgreSQL for development: runs PGlite (Postgres compiled
 * to WASM) behind the Postgres wire protocol on 127.0.0.1:5432, persisting to
 * .pgdata/. Prisma, the keeper and the app connect to it like any Postgres.
 * Production uses a real managed PostgreSQL (see docs/DEPLOYMENT.md).
 *
 *   npm run db:local
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { join } from "node:path";
import { ROOT } from "./lib";

const port = Number(process.env.PGPORT ?? 5432);
const db = await PGlite.create(join(ROOT, ".pgdata"));
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 64 });
await server.start();
console.log(`local postgres (PGlite) listening on 127.0.0.1:${port} — data in .pgdata/`);

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
