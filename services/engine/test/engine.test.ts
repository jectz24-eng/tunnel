/**
 * Engine loops against real PostgreSQL (PGlite) and a scripted Solana RPC:
 * cycle transitions, entropy waiting, voiding, and the exactly-once payout
 * state machine (send → confirm / fail / expire → re-sign).
 */
import { Keypair, type Connection } from "@solana/web3.js";
import type { PrismaClient } from "@tunnel/db";
import { claimableFor, deploy, ensureConfig, recordReserveFunding, requestClaim, setPaused } from "@tunnel/core";
import { TUNNEL_UNIT } from "@tunnel/sdk";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fakeBlockhash, signer, startDb } from "../../../packages/core/test/harness";
import { cycleTick } from "../src/cycles";
import { reconcileSending, sendRequested, type PayoutContext } from "../src/payouts";

let db: PrismaClient;
let stop: () => Promise<void>;
beforeAll(async () => {
  ({ db, stop } = await startDb());
}, 60_000);
afterAll(async () => stop?.());

/** A scripted RPC: tests move slots/heights and decide what each signature's status is. */
function fakeChain() {
  const chain = {
    slot: 1_000n,
    finalized: 900n,
    height: 500n,
    blocks: new Map<bigint, string>(),
    sent: [] as string[],
    statuses: new Map<string, { err: unknown; confirmationStatus: string } | null>(),
    failSend: false,
    conn: null as unknown as Connection,
  };
  chain.conn = {
    getSlot: async (c?: string) => Number(c === "finalized" ? chain.finalized : chain.slot),
    getBlocks: async (start: number, end: number) => [...chain.blocks.keys()].map(Number).filter((s) => s >= start && s <= end).sort((a, b) => a - b),
    getBlock: async (slot: number) => ({ blockhash: chain.blocks.get(BigInt(slot))! }),
    getBalance: async () => 1_000_000_000,
    getTokenAccountBalance: async () => ({ value: { amount: (10n ** 15n).toString() } }),
    getLatestBlockhash: async () => ({ blockhash: fakeBlockhash(), lastValidBlockHeight: Number(chain.height + 150n) }),
    sendRawTransaction: async (raw: Buffer) => {
      if (chain.failSend) throw new Error("preflight failed");
      chain.sent.push(raw.toString("base64"));
      return "x";
    },
    getSignatureStatuses: async (sigs: string[]) => ({ value: sigs.map((s) => chain.statuses.get(s) ?? null) }),
    getBlockHeight: async () => Number(chain.height),
  } as unknown as Connection;
  return chain;
}

async function reset() {
  await db.$executeRawUnsafe(
    `TRUNCATE "Payout", "Experiment", "Position", "Cycle", "ProtocolEvent", "WalletStats", "UsedNonce", "User", "ProtocolConfig" RESTART IDENTITY CASCADE`,
  );
  await ensureConfig(db);
  await recordReserveFunding(db, 1_000_000n * TUNNEL_UNIT, "test", "admin");
  await setPaused(db, false, "admin");
}

const t0 = Date.now();
const at = (s: number) => new Date(t0 + s * 1000);

describe("cycle loop", () => {
  beforeEach(reset);

  it("opens, closes, waits for the entropy block, settles and opens the next", async () => {
    const chain = fakeChain();
    let r = await cycleTick(chain.conn, db, 3_600_000, at(0));
    expect(r.open).toBe("opened 1");
    const c1 = await db.cycle.findUniqueOrThrow({ where: { id: 1n } });

    const a = signer();
    await deploy(db, a.deployment(1n, 0, 4, 20), at(1));

    r = await cycleTick(chain.conn, db, 3_600_000, at(601));
    expect(r.closed).toEqual([1n]);
    expect(r.settled).toEqual([]); // entropy slot not finalized yet
    expect(r.open).toBe("opened 2");

    chain.finalized = c1.entropySlot + 5n;
    chain.blocks.set(c1.entropySlot + 2n, fakeBlockhash()); // entropySlot and +1 were skipped
    r = await cycleTick(chain.conn, db, 3_600_000, at(700));
    expect(r.settled).toEqual([1n]);
    const settled = await db.cycle.findUniqueOrThrow({ where: { id: 1n } });
    expect(settled.entropySlotUsed).toBe(c1.entropySlot + 2n);
    expect(settled.entropyBlockhash).toBe(chain.blocks.get(c1.entropySlot + 2n));
    expect((await db.walletStats.findUniqueOrThrow({ where: { owner: a.wallet } })).cyclesPlayed).toBe(1);
    expect((await claimableFor(db, a.wallet)).amount > 0n).toBe(true);
  });

  it("voids a cycle whose entropy block never becomes readable", async () => {
    const chain = fakeChain();
    await cycleTick(chain.conn, db, 60_000, at(0));
    await cycleTick(chain.conn, db, 60_000, at(601));
    const r = await cycleTick(chain.conn, db, 60_000, at(700));
    expect(r.voided).toEqual([1n]);
  });

  it("stays idle while paused", async () => {
    await setPaused(db, true, "admin");
    const r = await cycleTick(fakeChain().conn, db, 60_000, at(0));
    expect(r.open).toBe("paused");
  });
});

describe("payouts", () => {
  beforeEach(reset);

  async function claimed(chain: ReturnType<typeof fakeChain>) {
    await cycleTick(chain.conn, db, 3_600_000, at(0));
    const a = signer();
    await deploy(db, a.deployment(1n, 0, 4, 20), at(1));
    await cycleTick(chain.conn, db, 3_600_000, at(601));
    const c = await db.cycle.findUniqueOrThrow({ where: { id: 1n } });
    chain.finalized = c.entropySlot;
    chain.blocks.set(c.entropySlot, fakeBlockhash());
    await cycleTick(chain.conn, db, 3_600_000, at(700));
    const claim = await requestClaim(db, a.claim());
    return { a, claim };
  }

  const ctx = (chain: ReturnType<typeof fakeChain>): PayoutContext => ({
    conn: chain.conn,
    db,
    wallet: Keypair.generate(),
    mint: Keypair.generate().publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    maxPayoutTokens: 1_000_000n,
    minFeeLamports: 0n,
  });

  it("records the signature before sending, then confirms", async () => {
    const chain = fakeChain();
    const { a, claim } = await claimed(chain);
    const c = ctx(chain);
    await sendRequested(c);
    expect(chain.sent).toHaveLength(1);
    const p = await db.payout.findUniqueOrThrow({ where: { id: claim.payoutId } });
    expect(p.status).toBe("sending");
    await sendRequested(c); // nothing new to send
    expect(chain.sent).toHaveLength(1);

    chain.statuses.set(p.txSignature!, { err: null, confirmationStatus: "confirmed" });
    await reconcileSending(c);
    expect((await db.payout.findUniqueOrThrow({ where: { id: claim.payoutId } })).status).toBe("confirmed");
    expect((await db.walletStats.findUniqueOrThrow({ where: { owner: a.wallet } })).tokensClaimed).toBe(claim.amount);
  });

  it("re-signs only after the previous transaction provably expired", async () => {
    const chain = fakeChain();
    const { claim } = await claimed(chain);
    const c = ctx(chain);
    chain.failSend = true;
    await sendRequested(c);
    const first = (await db.payout.findUniqueOrThrow({ where: { id: claim.payoutId } })).txSignature;

    await reconcileSending(c); // not expired yet
    expect((await db.payout.findUniqueOrThrow({ where: { id: claim.payoutId } })).status).toBe("sending");

    chain.height += 200n;
    await reconcileSending(c);
    expect((await db.payout.findUniqueOrThrow({ where: { id: claim.payoutId } })).status).toBe("requested");

    chain.failSend = false;
    await sendRequested(c);
    const second = await db.payout.findUniqueOrThrow({ where: { id: claim.payoutId } });
    expect(second.status).toBe("sending");
    expect(second.txSignature).not.toBe(first);
    expect(second.attempts).toBe(2);
  });

  it("returns a failed transfer to the claimable balance", async () => {
    const chain = fakeChain();
    const { a, claim } = await claimed(chain);
    const c = ctx(chain);
    await sendRequested(c);
    const p = await db.payout.findUniqueOrThrow({ where: { id: claim.payoutId } });
    chain.statuses.set(p.txSignature!, { err: { InstructionError: [3, "Custom"] }, confirmationStatus: "confirmed" });
    await reconcileSending(c);
    expect((await db.payout.findUniqueOrThrow({ where: { id: claim.payoutId } })).status).toBe("failed");
    expect((await claimableFor(db, a.wallet)).amount).toBe(claim.amount);
  });

  it("holds payouts above the safety cap", async () => {
    const chain = fakeChain();
    const { claim } = await claimed(chain);
    await sendRequested({ ...ctx(chain), maxPayoutTokens: 0n });
    expect(chain.sent).toHaveLength(0);
    expect((await db.payout.findUniqueOrThrow({ where: { id: claim.payoutId } })).status).toBe("requested");
  });
});
