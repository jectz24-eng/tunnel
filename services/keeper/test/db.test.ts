/**
 * Backend integration test against a real PostgreSQL engine (PGlite, in
 * process) with the production migration applied. Covers idempotent event
 * ingestion, duplicate deliveries, keeper restarts and aggregate recompute.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@tunnel/db";
import { IDL, TUNNEL_PROGRAM_ID, coder } from "@tunnel/sdk";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeTx, rowsFromTx, writeTx } from "../src/ingest";
import { Reconciler, positionsFromEvents } from "../src/reconciler";

let pg: PGlite;
let server: PGLiteSocketServer;
let db: PrismaClient;
const port = 55_000 + Math.floor(Math.random() * 5_000);

/** Builds the exact log lines a TUNNEL transaction emits for the given events. */
function logsFor(events: { name: string; data: Record<string, unknown> }[]): string[] {
  const id = TUNNEL_PROGRAM_ID.toBase58();
  const lines = [`Program ${id} invoke [1]`];
  for (const e of events) {
    const disc = createHash("sha256").update(`event:${e.name}`).digest().subarray(0, 8);
    const body = coder.types.encode(e.name, e.data);
    lines.push(`Program data: ${Buffer.concat([disc, body]).toString("base64")}`);
  }
  lines.push(`Program ${id} consumed 5000 of 200000 compute units`, `Program ${id} success`);
  return lines;
}

const owner = Keypair.generate().publicKey;
const deployed = (count: number) => ({
  name: "ParticlesDeployed",
  data: {
    round_id: new BN(4), owner, barrier: 2, count, lamports: new BN(count * 10_000_000),
    position_particles: [0, 0, count], round_total_lamports: new BN(count * 10_000_000),
  },
});

beforeAll(async () => {
  pg = await PGlite.create();
  const migrations = join(__dirname, "../../../packages/db/prisma/migrations");
  for (const dir of readdirSync(migrations).filter((d) => !d.endsWith(".toml")).sort()) {
    await pg.exec(readFileSync(join(migrations, dir, "migration.sql"), "utf8"));
  }
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 16 });
  await server.start();
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres` }) });
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  await server?.stop();
  await pg?.close();
});

describe("event decoding", () => {
  it("decodes program events from transaction logs", () => {
    const tx = decodeTx(TUNNEL_PROGRAM_ID, "sigA", 100, 1_700_000_000, logsFor([deployed(3)]));
    expect(tx.events).toHaveLength(1);
    const rows = rowsFromTx(tx);
    expect(rows.deposits[0]).toMatchObject({ roundId: 4n, owner: owner.toBase58(), barrier: 2, count: 3, lamports: 30_000_000n });
    expect([...rows.roundIds]).toEqual([4n]);
  });

  it("ignores logs from other programs", () => {
    const other = logsFor([deployed(1)]).map((l) => l.replace(TUNNEL_PROGRAM_ID.toBase58(), PublicKey.default.toBase58()));
    expect(decodeTx(TUNNEL_PROGRAM_ID, "sigX", 1, null, other).events).toHaveLength(0);
  });

  it("knows every #[event] declared in the Rust program", () => {
    const rs = readFileSync(join(__dirname, "../../../programs/tunnel/src/events.rs"), "utf8");
    const names = [...rs.matchAll(/#\[event\]\s+pub struct (\w+)/g)].map((m) => m[1]).sort();
    expect(IDL.events!.map((e) => e.name).sort()).toEqual(names);
  });
});

describe("idempotent ingestion", () => {
  it("writes each event exactly once under duplicate delivery (websocket + backfill + restart)", async () => {
    const tx = decodeTx(TUNNEL_PROGRAM_ID, "sigDup", 200, 1_700_000_100, logsFor([deployed(2), deployed(5)]));
    await writeTx(db, tx);
    await writeTx(db, tx); // websocket duplicate
    await Promise.all([writeTx(db, tx), writeTx(db, tx)]); // concurrent backfill overlap
    expect(await db.indexedEvent.count({ where: { signature: "sigDup" } })).toBe(2);
    expect(await db.deposit.count({ where: { signature: "sigDup" } })).toBe(2);
    const sum = await db.deposit.aggregate({ where: { owner: owner.toBase58() }, _sum: { count: true } });
    expect(sum._sum.count).toBe(7);
  });

  it("resumes from the stored cursor after a restart", async () => {
    await db.indexerCursor.upsert({ where: { id: "program-signatures" }, create: { id: "program-signatures", lastSignature: "sigDup", lastSlot: 200n }, update: {} });
    // A brand-new client (simulated restart) sees the same cursor.
    const restarted = new PrismaClient({ adapter: new PrismaPg({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres` }) });
    const c = await restarted.indexerCursor.findUnique({ where: { id: "program-signatures" } });
    expect(c?.lastSignature).toBe("sigDup");
    await restarted.$disconnect();
  });
});

describe("wallet aggregates", () => {
  it("are recomputed from positions, so re-running never double-counts", async () => {
    const roundBase = {
      status: "settled", outcome: "rewards", openTs: new Date(), closeTs: new Date(), barrierBps: [6500, 3000, 1000], barrierWeights: [1, 2, 5],
      particleCostLamports: 10_000_000n, protocolFeeBps: 500, emissionBudget: 416_000_000n, particles: [0n, 0n, 7n], totalLamports: 70_000_000n,
      participants: 1, successes: [0n, 0n, 1n], totalSuccessWeight: 5n, feeLamports: 3_500_000n, distributableLamports: 66_500_000n, claims: 0,
    };
    await db.round.create({ data: { id: 4n, ...roundBase } });
    await db.position.create({
      data: {
        roundId: 4n, owner: owner.toBase58(), address: Keypair.generate().publicKey.toBase58(), particles: [0, 0, 7], lamports: 70_000_000n,
        settled: true, successes: [0, 0, 1], successWeight: 5n, claimed: false, lamportsPaid: 0n, tokensPaid: 0n,
        expectedLamports: 66_500_000n, expectedTokens: 416_000_000n,
      },
    });
    const rec = new Reconciler(null as never, db, TUNNEL_PROGRAM_ID, 10);
    await rec.recomputeWalletStats([owner.toBase58()]);
    await rec.recomputeWalletStats([owner.toBase58()]);
    const s = await db.walletStats.findUniqueOrThrow({ where: { owner: owner.toBase58() } });
    expect(s).toMatchObject({ roundsPlayed: 1, particles: 7n, successes: 1n, failures: 6n, lamportsCommitted: 70_000_000n, lamportsReceived: 0n, tokensMined: 416_000_000n, claimableRounds: 1 });
  });
});

describe("closed positions", () => {
  it("are rebuilt from events after claim closes the account", async () => {
    const who = Keypair.generate().publicKey;
    const ev = (name: string, data: Record<string, unknown>) => ({ name, data });
    await writeTx(db, decodeTx(TUNNEL_PROGRAM_ID, "sigP1", 300, 1_700_000_300, logsFor([
      ev("ParticlesDeployed", { round_id: new BN(9), owner: who, barrier: 0, count: 10, lamports: new BN(100_000_000), position_particles: [10, 0, 0], round_total_lamports: new BN(100_000_000) }),
    ])));
    await writeTx(db, decodeTx(TUNNEL_PROGRAM_ID, "sigP2", 301, 1_700_000_301, logsFor([
      ev("ParticlesDeployed", { round_id: new BN(9), owner: who, barrier: 2, count: 2, lamports: new BN(20_000_000), position_particles: [10, 0, 2], round_total_lamports: new BN(120_000_000) }),
    ])));
    await writeTx(db, decodeTx(TUNNEL_PROGRAM_ID, "sigP3", 302, 1_700_000_302, logsFor([
      ev("PositionSettled", { round_id: new BN(9), owner: who, particles: [10, 0, 2], successes: [8, 0, 1], success_weight: new BN(13) }),
    ])));
    await writeTx(db, decodeTx(TUNNEL_PROGRAM_ID, "sigP4", 303, 1_700_000_303, logsFor([
      ev("RewardClaimed", { round_id: new BN(9), owner: who, lamports: new BN(114_000_000), tokens: new BN(416_000_000), outcome: 1 }),
    ])));
    const [p] = await positionsFromEvents(db, 9n, TUNNEL_PROGRAM_ID);
    expect(p.owner.equals(who)).toBe(true);
    expect(p).toMatchObject({ particles: [10, 0, 2], lamports: 120_000_000n, settled: true, successes: [8, 0, 1], successWeight: 13n, claimed: true, lamportsPaid: 114_000_000n, tokensPaid: 416_000_000n });
  });
});
