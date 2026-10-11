/**
 * Backend integration test against a real PostgreSQL engine (PGlite, in
 * process) with the production migration applied. Covers idempotent event
 * ingestion, duplicate deliveries, keeper restarts, experiment outcome
 * derivation, rebuilt closed positions and aggregate recompute.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@tunnel/db";
import { DEFAULT_PARAMS, IDL, TUNNEL_PROGRAM_ID, coder, cyclePda, deriveOdds, particleOutcomes, type CycleAccount, type PositionAccount } from "@tunnel/sdk";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeTx, rowsFromTx, writeTx } from "../src/ingest";
import { Reconciler, cycleRow, positionsFromEvents } from "../src/reconciler";

let pg: PGlite;
let server: PGLiteSocketServer;
let db: PrismaClient;
const port = 55_000 + Math.floor(Math.random() * 5_000);
const odds = deriveOdds(DEFAULT_PARAMS);

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

const deployed = (owner: PublicKey, cycle: number, seq: number, barrier: number, level: number, count: number, firstIndex: number, energyUsed: number) => ({
  name: "ParticlesDeployed",
  data: {
    cycle_id: new BN(cycle), owner, experiment: seq, barrier, level, count, first_index: firstIndex,
    energy_cost: count * DEFAULT_PARAMS.levels[level].cost, energy_used: energyUsed, energy_per_cycle: 100,
    height_milli: DEFAULT_PARAMS.barriers[barrier].heightMilli, width_milli: DEFAULT_PARAMS.barriers[barrier].widthMilli,
    energy_bps: DEFAULT_PARAMS.levels[level].energyBps,
    transmission_ppb: odds.transmissionPpb[barrier][level], nominal_reward: new BN(odds.reward[barrier][level].toString()),
  },
});

const owner = Keypair.generate().publicKey;

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
  it("maps ParticlesDeployed to an experiment row with its physical inputs", () => {
    const tx = decodeTx(TUNNEL_PROGRAM_ID, "sigA", 100, 1_700_000_000, logsFor([deployed(owner, 4, 0, 2, 1, 3, 0, 6)]));
    expect(tx.events).toHaveLength(1);
    const rows = rowsFromTx(tx);
    expect(rows.experiments[0]).toMatchObject({
      cycleId: 4n, owner: owner.toBase58(), seq: 0, barrier: 2, level: 1, count: 3, firstIndex: 0, energyCost: 6,
      heightMilli: 4_000, widthMilli: 1_500, energyBps: 3_500, transmissionPpb: odds.transmissionPpb[2][1],
    });
    expect([...rows.cycleIds]).toEqual([4n]);
    expect([...rows.owners]).toEqual([owner.toBase58()]);
  });

  it("ignores logs from other programs", () => {
    const other = logsFor([deployed(owner, 1, 0, 0, 0, 1, 0, 1)]).map((l) => l.replace(TUNNEL_PROGRAM_ID.toBase58(), PublicKey.default.toBase58()));
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
    const tx = decodeTx(TUNNEL_PROGRAM_ID, "sigDup", 200, 1_700_000_100, logsFor([deployed(owner, 4, 0, 0, 0, 2, 0, 2), deployed(owner, 4, 1, 0, 0, 5, 2, 7)]));
    await writeTx(db, tx);
    await writeTx(db, tx); // websocket duplicate
    await Promise.all([writeTx(db, tx), writeTx(db, tx)]); // concurrent backfill overlap
    expect(await db.indexedEvent.count({ where: { signature: "sigDup" } })).toBe(2);
    expect(await db.experiment.count({ where: { signature: "sigDup" } })).toBe(2);
    const sum = await db.experiment.aggregate({ where: { owner: owner.toBase58() }, _sum: { count: true } });
    expect(sum._sum.count).toBe(7);
    const user = await db.user.findUniqueOrThrow({ where: { wallet: owner.toBase58() } });
    expect(user.firstSeenAt.getTime()).toBe(1_700_000_100_000);
  });

  it("resumes from the stored cursor after a restart", async () => {
    await db.indexerCursor.upsert({ where: { id: "program-signatures" }, create: { id: "program-signatures", lastSignature: "sigDup", lastSlot: 200n }, update: {} });
    const restarted = new PrismaClient({ adapter: new PrismaPg({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres` }) });
    const c = await restarted.indexerCursor.findUnique({ where: { id: "program-signatures" } });
    expect(c?.lastSignature).toBe("sigDup");
    await restarted.$disconnect();
  });

  it("rejects rows that violate domain constraints", async () => {
    await expect(
      db.experiment.create({
        data: { ...rowsFromTx(decodeTx(TUNNEL_PROGRAM_ID, "sigBad", 1, null, logsFor([deployed(owner, 99, 0, 0, 0, 1, 0, 1)]))).experiments[0], barrier: 7 },
      }),
    ).rejects.toThrow();
  });
});

describe("experiment outcomes", () => {
  it("are derived from the cycle randomness, split per experiment, and match the settled position", async () => {
    const who = Keypair.generate().publicKey;
    const randomness = Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) & 0xff);
    // Two experiments in the same cell (indices 0..9 and 10..14) and one in another cell.
    await writeTx(db, decodeTx(TUNNEL_PROGRAM_ID, "sigE1", 400, 1_700_000_400, logsFor([deployed(who, 12, 0, 0, 2, 10, 0, 30)])));
    await writeTx(db, decodeTx(TUNNEL_PROGRAM_ID, "sigE2", 401, 1_700_000_401, logsFor([deployed(who, 12, 1, 0, 2, 5, 10, 45)])));
    await writeTx(db, decodeTx(TUNNEL_PROGRAM_ID, "sigE3", 402, 1_700_000_402, logsFor([deployed(who, 12, 2, 2, 0, 20, 0, 65)])));

    const cell = (b: number, l: number, n: number) => particleOutcomes(randomness, 12n, who.toBytes(), b, l, n, odds.transmissionPpb[b][l]).filter((o) => o.success).length;
    const successes = [[0, 0, cell(0, 2, 15), 0, 0], [0, 0, 0, 0, 0], [cell(2, 0, 20), 0, 0, 0, 0]];
    const nominal = BigInt(successes[0][2]) * odds.reward[0][2] + BigInt(successes[2][0]) * odds.reward[2][0];
    const cycle: CycleAccount = {
      address: cyclePda(12n), id: 12n, status: "settled", outcome: "rewards", openTs: 1, closeTs: 2, closedTs: 3,
      barriers: DEFAULT_PARAMS.barriers, levels: DEFAULT_PARAMS.levels, odds, energyPerCycle: 100, randomnessTimeoutSecs: 900,
      emissionBudget: nominal / 2n, participants: 1, experiments: 3, particles: [15n, 0n, 20n], energyUsed: 65n,
      vrfSeed: new Uint8Array(32).fill(1), randomnessRequestedTs: 4, randomness, positionsSettled: 1,
      successes: [BigInt(successes[0][2]), 0n, BigInt(successes[2][0])], totalNominal: nominal, tokensAllocated: nominal / 2n,
      settledTs: 5, claims: 0, tokensClaimed: 0n, swept: false,
    };
    const position: PositionAccount = {
      address: cyclePda(0n), owner: who, cycleId: 12n, particles: [[0, 0, 15, 0, 0], [0, 0, 0, 0, 0], [20, 0, 0, 0, 0]],
      energyUsed: 65, experiments: 3, settled: true, successes, nominalReward: nominal, claimed: false, tokensPaid: 0n,
    };
    await db.cycle.create({ data: { id: 12n, ...cycleRow(cycle) } });
    const rec = new Reconciler(null as never, db, TUNNEL_PROGRAM_ID, 10);
    await rec.reconcileExperiments(cycle, [position]);

    const rows = await db.experiment.findMany({ where: { cycleId: 12n, owner: who.toBase58() }, orderBy: { seq: "asc" } });
    expect(rows.map((r) => r.status)).toEqual(["settled", "settled", "settled"]);
    expect(rows[0].successes! + rows[1].successes!).toBe(successes[0][2]);
    expect(rows[2].successes).toBe(successes[2][0]);
    expect(rows[0].outcomeBits).toHaveLength(10);
    expect(rows[1].outcomeBits).toHaveLength(5);
    // Budget is half the nominal total: every experiment is scaled down, never paid above its nominal.
    for (const r of rows) expect(r.rewardTokens! <= BigInt(r.successes!) * r.nominalReward).toBe(true);
  });
});

describe("closed positions", () => {
  it("are rebuilt from events after claim closes the account", async () => {
    const who = Keypair.generate().publicKey;
    const ev = (name: string, data: Record<string, unknown>) => ({ name, data });
    await writeTx(db, decodeTx(TUNNEL_PROGRAM_ID, "sigP1", 300, 1_700_000_300, logsFor([deployed(who, 9, 0, 0, 0, 10, 0, 10)])));
    await writeTx(db, decodeTx(TUNNEL_PROGRAM_ID, "sigP2", 301, 1_700_000_301, logsFor([deployed(who, 9, 1, 2, 4, 2, 0, 20)])));
    const particles = [[10, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 2]];
    const successes = [[8, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 1]];
    await writeTx(db, decodeTx(TUNNEL_PROGRAM_ID, "sigP3", 302, 1_700_000_302, logsFor([
      ev("PositionSettled", { cycle_id: new BN(9), owner: who, particles, successes, nominal_reward: new BN(13_000_000) }),
    ])));
    await writeTx(db, decodeTx(TUNNEL_PROGRAM_ID, "sigP4", 303, 1_700_000_303, logsFor([
      ev("RewardClaimed", { cycle_id: new BN(9), owner: who, tokens: new BN(13_000_000), outcome: 1 }),
    ])));
    const [p] = await positionsFromEvents(db, 9n, TUNNEL_PROGRAM_ID);
    expect(p.owner.equals(who)).toBe(true);
    expect(p).toMatchObject({ particles, energyUsed: 20, experiments: 2, settled: true, successes, nominalReward: 13_000_000n, claimed: true, tokensPaid: 13_000_000n });
  });
});

describe("wallet aggregates", () => {
  it("are recomputed from positions (idempotent) with streaks and best cycle", async () => {
    const who = Keypair.generate().publicKey.toBase58();
    const mk = (id: bigint) => ({
      id, address: cyclePda(id).toBase58(), status: "settled", outcome: "rewards", openTs: new Date(), closeTs: new Date(), energyPerCycle: 100,
      barriers: [], levels: [], odds: {}, emissionBudget: 10n ** 12n, participants: 1, experiments: 1, particles: [0n, 0n, 0n], energyUsed: 10n,
      successes: [0n, 0n, 0n], totalNominal: 0n, tokensAllocated: 0n, claims: 0, tokensClaimed: 0n,
    });
    // Cycles 20,21,22 tunnel (streak 3), 23 reflects, 25 tunnels (gap → streak 1).
    const plays: [bigint, number, bigint][] = [[20n, 2, 5n], [21n, 1, 9n], [22n, 3, 4n], [23n, 0, 0n], [25n, 1, 7n]];
    for (const [id, s, tokens] of plays) {
      await db.cycle.upsert({ where: { id }, create: mk(id), update: {} });
      await db.position.create({
        data: {
          cycleId: id, owner: who, address: Keypair.generate().publicKey.toBase58(), particles: [10, ...Array(14).fill(0)], successes: [s, ...Array(14).fill(0)],
          energyUsed: 10, experiments: 1, settled: true, nominalReward: tokens, claimed: id === 21n, tokensPaid: id === 21n ? tokens : 0n, expectedTokens: tokens,
        },
      });
    }
    const rec = new Reconciler(null as never, db, TUNNEL_PROGRAM_ID, 10);
    await rec.recomputeWalletStats([who]);
    await rec.recomputeWalletStats([who]);
    const s = await db.walletStats.findUniqueOrThrow({ where: { owner: who } });
    expect(s).toMatchObject({
      cyclesPlayed: 5, experiments: 5, particles: 50n, successes: 7n, failures: 43n, energyUsed: 50n,
      tokensEarned: 25n, tokensClaimed: 9n, bestCycleTokens: 9n, longestStreak: 3, currentStreak: 1, claimableCycles: 4,
    });
  });
});
