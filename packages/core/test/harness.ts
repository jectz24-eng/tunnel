/** Real PostgreSQL (PGlite, in process) with the production migrations applied. */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaPg } from "@prisma/adapter-pg";
import { Keypair } from "@solana/web3.js";
import { PrismaClient } from "@tunnel/db";
import { claimMessage, deploymentMessage, encodeBase58 } from "@tunnel/sdk";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import nacl from "tweetnacl";

export async function startDb() {
  const pg = await PGlite.create();
  const migrations = join(import.meta.dirname, "../../db/prisma/migrations");
  for (const dir of readdirSync(migrations).filter((d) => !d.endsWith(".toml")).sort()) {
    await pg.exec(readFileSync(join(migrations, dir, "migration.sql"), "utf8"));
  }
  const port = 55_000 + Math.floor(Math.random() * 5_000);
  const server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 16 });
  await server.start();
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`, max: 1 }) });
  return {
    db,
    stop: async () => {
      await db.$disconnect();
      await server.stop();
      await pg.close();
    },
  };
}

export const nonce = () => randomBytes(12).toString("base64url");

export function signer() {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const sign = (message: string) => encodeBase58(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
  return {
    wallet,
    sign,
    deployment(cycleId: bigint, barrier: number, level: number, count: number, issuedAt = new Date()) {
      const message = deploymentMessage({ wallet, cycleId, barrier, level, count, nonce: nonce(), issuedAt: issuedAt.toISOString() });
      return { message, signature: sign(message) };
    },
    claim(issuedAt = new Date()) {
      const message = claimMessage({ wallet, nonce: nonce(), issuedAt: issuedAt.toISOString() });
      return { message, signature: sign(message) };
    },
  };
}

/** A valid base58 32-byte value standing in for a Solana blockhash. */
export const fakeBlockhash = () => encodeBase58(randomBytes(32));
