/**
 * TUNNEL Anchor integration tests (localnet).
 *
 * The local validator clones the real ORAO VRF program from devnet and this
 * suite initialises a local ORAO network state with its own fulfillment key,
 * so randomness is produced by the actual ORAO program logic, just signed by a
 * key we control. Every expected payout is recomputed independently with the
 * SDK math and compared to what the program paid onchain.
 *
 * Run: `anchor test` (needs Solana CLI + Anchor 0.32.1; see docs/DEPLOYMENT.md).
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { FulfillBuilder, InitBuilder, Orao } from "@orao-network/solana-vrf";
import {
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { assert, expect } from "chai";
import nacl from "tweetnacl";
import {
  DEFAULT_PARAMS,
  TUNNEL_DECIMALS,
  TUNNEL_MINING_RESERVE,
  TUNNEL_TOTAL_SUPPLY,
  IDL,
  TunnelInstructions,
  computePayout,
  fetchPosition,
  fetchProtocol,
  fetchRound,
  fetchRoundPositions,
  parseEvents,
  positionPda,
  roundVaultPda,
  splitFee,
  treasuryVaultPda,
  verifyRound,
  type ProtocolParams,
} from "../packages/sdk/src";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const connection = provider.connection;
const admin = (provider.wallet as anchor.Wallet).payer;
const tunnel = new TunnelInstructions();
const programId = tunnel.programId;
const vrf = new Orao(provider);
const vrfTreasury = Keypair.generate();
const fulfillmentAuthority = Keypair.generate();
const treasury = Keypair.generate();

const TEST_PARAMS: ProtocolParams = { ...DEFAULT_PARAMS, roundDurationSecs: 30, randomnessTimeoutSecs: 120 };
let mint: PublicKey;

// ---------------------------------------------------------------- helpers

async function send(ixs: TransactionInstruction[], signers: Keypair[] = []) {
  const tx = new Transaction().add(...ixs);
  return provider.sendAndConfirm(tx, signers, { commitment: "confirmed" });
}

async function expectError(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e: any) {
    const text = [String(e?.message ?? e), ...(e?.logs ?? []), ...(e?.transactionLogs ?? [])].join("\n");
    expect(text, `expected ${code}`).to.include(code);
    return;
  }
  assert.fail(`expected transaction to fail with ${code}`);
}

async function chainTime(): Promise<number> {
  const slot = await connection.getSlot("confirmed");
  return (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
}

async function waitUntilChainTime(ts: number) {
  while ((await chainTime()) < ts) await new Promise((r) => setTimeout(r, 1000));
}

async function newUser(sol = 20) {
  const kp = Keypair.generate();
  const sig = await connection.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
  return kp;
}

async function protocol() {
  return (await fetchProtocol(connection, programId))!;
}

async function round(id: bigint) {
  return (await fetchRound(connection, id, programId))!;
}

async function openRound() {
  const p = await protocol();
  await send([tunnel.openRound(admin.publicKey, p.nextRoundId)]);
  return p.nextRoundId;
}

async function fulfill(seed: Uint8Array) {
  const signature = nacl.sign.detached(seed, fulfillmentAuthority.secretKey);
  await new FulfillBuilder(vrf, seed).withComputeUnitPrice(0n).rpc(fulfillmentAuthority.publicKey, signature);
}

/** close → request → fulfill → reveal → settle all → finalize */
async function resolveRound(id: bigint) {
  const r0 = await round(id);
  await waitUntilChainTime(r0.closeTs);
  await send([tunnel.closeRound(id)]);
  const closed = await round(id);
  await send([tunnel.requestRandomness({ cranker: admin.publicKey, roundId: id, vrfSeed: closed.vrfSeed, vrfTreasury: vrfTreasury.publicKey })]);
  await fulfill(closed.vrfSeed);
  await send([tunnel.revealRandomness(id, closed.vrfSeed)]);
  for (const p of await fetchRoundPositions(connection, id, programId)) await send([tunnel.settlePosition(id, p.owner)]);
  await send([tunnel.finalizeRound(id)]);
  return round(id);
}

/** Claims and returns what the program paid, read from the RewardClaimed event in the tx logs. */
async function claimAndRead(user: Keypair, roundId: bigint) {
  const sig = await send([tunnel.claim({ owner: user.publicKey, roundId, tunnelMint: mint })], [user]);
  const tx = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const ev = parseEvents(programId, tx!.meta!.logMessages!).find((e) => e.name === "RewardClaimed")!;
  return { sig, lamports: BigInt(ev.data.lamports.toString()), tokens: BigInt(ev.data.tokens.toString()), fee: BigInt(tx!.meta!.fee) };
}

async function tokenBalance(owner: PublicKey) {
  try {
    return (await getAccount(connection, getAssociatedTokenAddressSync(mint, owner))).amount;
  } catch {
    return 0n;
  }
}

// ---------------------------------------------------------------- suite

describe("tunnel", function () {
  this.timeout(1_000_000);
  let u1: Keypair, u2: Keypair, u3: Keypair, attacker: Keypair;

  before(async () => {
    // Local ORAO network state with a fulfillment key we control.
    await new InitBuilder(vrf, admin.publicKey, vrfTreasury.publicKey, [fulfillmentAuthority.publicKey], new BN(1_000_000)).rpc();
    [u1, u2, u3, attacker] = await Promise.all([newUser(), newUser(), newUser(), newUser()]);
    await connection.confirmTransaction(await connection.requestAirdrop(treasury.publicKey, LAMPORTS_PER_SOL), "confirmed");
    await connection.confirmTransaction(await connection.requestAirdrop(vrfTreasury.publicKey, LAMPORTS_PER_SOL), "confirmed");

    mint = await createMint(connection, admin, admin.publicKey, null, TUNNEL_DECIMALS);
    const adminAta = await getOrCreateAssociatedTokenAccount(connection, admin, mint, admin.publicKey);
    await mintTo(connection, admin, mint, adminAta.address, admin, TUNNEL_TOTAL_SUPPLY);
  });

  describe("initialization", () => {
    it("rejects initialization by anyone other than the upgrade authority", async () => {
      const ix = tunnel.initialize({ admin: attacker.publicKey, tunnelMint: mint, treasury: treasury.publicKey, params: TEST_PARAMS });
      await expectError(send([ix], [attacker]), "Unauthorized");
    });

    it("rejects invalid parameters", async () => {
      const bad = { ...TEST_PARAMS, protocolFeeBps: 2_000 };
      await expectError(send([tunnel.initialize({ admin: admin.publicKey, tunnelMint: mint, treasury: treasury.publicKey, params: bad })]), "InvalidParams");
      const badOdds = { ...TEST_PARAMS, barriers: [{ transmissionBps: 10_000, rewardWeight: 1 }, TEST_PARAMS.barriers[1], TEST_PARAMS.barriers[2]] as ProtocolParams["barriers"] };
      await expectError(send([tunnel.initialize({ admin: admin.publicKey, tunnelMint: mint, treasury: treasury.publicKey, params: badOdds })]), "InvalidParams");
    });

    it("initializes the protocol and the token reward vault", async () => {
      await send([tunnel.initialize({ admin: admin.publicKey, tunnelMint: mint, treasury: treasury.publicKey, params: TEST_PARAMS })]);
      const p = await protocol();
      expect(p.admin.equals(admin.publicKey)).to.be.true;
      expect(p.tunnelMint.equals(mint)).to.be.true;
      expect(p.params.protocolFeeBps).to.equal(500);
      expect(p.params.barriers.map((b) => b.transmissionBps)).to.deep.equal([6500, 3000, 1000]);
      const vault = await getAccount(connection, p.rewardVault);
      expect(vault.mint.equals(mint)).to.be.true;
      expect(vault.owner.equals(p.address)).to.be.true; // PDA authority
    });

    it("cannot be initialized twice", async () => {
      await expectError(
        send([tunnel.initialize({ admin: admin.publicKey, tunnelMint: mint, treasury: treasury.publicKey, params: TEST_PARAMS })]),
        "already in use",
      );
    });

    it("funds the 600M mining reserve", async () => {
      const src = getAssociatedTokenAddressSync(mint, admin.publicKey);
      await send([tunnel.fundReserve({ funder: admin.publicKey, tunnelMint: mint, funderTokenAccount: src, amount: TUNNEL_MINING_RESERVE })]);
      const p = await protocol();
      expect(p.reserveAvailable).to.equal(TUNNEL_MINING_RESERVE);
      expect((await getAccount(connection, p.rewardVault)).amount).to.equal(TUNNEL_MINING_RESERVE);
    });
  });

  describe("round A — deposits, settlement, rewards, claims", () => {
    let id: bigint;

    it("opens a round with a parameter snapshot and emission budget", async () => {
      id = await openRound();
      const r = await round(id);
      expect(r.status).to.equal("open");
      expect(r.closeTs - r.openTs).to.equal(30);
      expect(r.emissionBudget).to.equal(416_000_000n);
      expect((await protocol()).reserveAvailable).to.equal(TUNNEL_MINING_RESERVE - 416_000_000n);
    });

    it("rejects scheduling a second upcoming round", async () => {
      await send([tunnel.openRound(admin.publicKey, id + 1n)]); // upcoming: starts when A ends
      const next = await round(id + 1n);
      expect(next.openTs).to.equal((await round(id)).closeTs);
      await expectError(send([tunnel.openRound(admin.publicKey, id + 2n)]), "RoundScheduleConflict");
    });

    it("rejects deposits into a round that has not started", async () => {
      await expectError(send([tunnel.deployParticles({ owner: u1.publicKey, roundId: id + 1n, barrier: 0, count: 1 })], [u1]), "RoundNotStarted");
    });

    it("accepts concurrent deposits from several users into escrow", async () => {
      const vaultBefore = await connection.getBalance(roundVaultPda(id, programId));
      await Promise.all([
        send([tunnel.deployParticles({ owner: u1.publicKey, roundId: id, barrier: 0, count: 10 })], [u1]),
        send(
          [
            tunnel.deployParticles({ owner: u2.publicKey, roundId: id, barrier: 1, count: 5 }),
            tunnel.deployParticles({ owner: u2.publicKey, roundId: id, barrier: 2, count: 2 }),
          ],
          [u2],
        ),
        send([tunnel.deployParticles({ owner: u3.publicKey, roundId: id, barrier: 2, count: 1 })], [u3]),
      ]);
      const r = await round(id);
      expect(r.participants).to.equal(3);
      expect(r.particles).to.deep.equal([10n, 5n, 3n]);
      expect(r.totalLamports).to.equal(18n * 10_000_000n);
      expect(BigInt(await connection.getBalance(roundVaultPda(id, programId))) - BigInt(vaultBefore)).to.equal(r.totalLamports);
      const p2 = (await fetchPosition(connection, id, u2.publicKey, programId))!;
      expect(p2.particles).to.deep.equal([0, 5, 2]);
      expect(p2.lamports).to.equal(70_000_000n);
    });

    it("validates barrier, count and the per-position limit", async () => {
      await expectError(send([tunnel.deployParticles({ owner: u1.publicKey, roundId: id, barrier: 3, count: 1 })], [u1]), "InvalidBarrier");
      await expectError(send([tunnel.deployParticles({ owner: u1.publicKey, roundId: id, barrier: 0, count: 0 })], [u1]), "ZeroParticles");
      await expectError(send([tunnel.deployParticles({ owner: u1.publicKey, roundId: id, barrier: 0, count: 191 })], [u1]), "PositionLimitExceeded");
      await expectError(send([tunnel.deployParticles({ owner: u1.publicKey, roundId: id, barrier: 0, count: 65_535 })], [u1]), "PositionLimitExceeded");
    });

    it("blocks deposits while paused and resumes after", async () => {
      await send([tunnel.setPaused(admin.publicKey, true)]);
      await expectError(send([tunnel.deployParticles({ owner: u3.publicKey, roundId: id, barrier: 0, count: 1 })], [u3]), "Paused");
      await send([tunnel.setPaused(admin.publicKey, false)]);
    });

    it("parameter updates never change an open round's snapshot", async () => {
      const changed = { ...TEST_PARAMS, protocolFeeBps: 900, barriers: [{ transmissionBps: 1, rewardWeight: 1 }, TEST_PARAMS.barriers[1], TEST_PARAMS.barriers[2]] as ProtocolParams["barriers"] };
      await send([tunnel.updateParams(admin.publicKey, changed)]);
      const r = await round(id);
      expect(r.protocolFeeBps).to.equal(500);
      expect(r.barriers[0].transmissionBps).to.equal(6500);
      await send([tunnel.updateParams(admin.publicKey, TEST_PARAMS)]);
    });

    it("rejects parameter updates from non-admins", async () => {
      await expectError(send([tunnel.updateParams(attacker.publicKey, TEST_PARAMS)], [attacker]), "Unauthorized");
      await expectError(send([tunnel.setPaused(attacker.publicKey, true)], [attacker]), "Unauthorized");
    });

    it("cannot be closed while the deposit window is open", async () => {
      await expectError(send([tunnel.closeRound(id)]), "RoundStillOpen");
    });

    it("rejects late deposits after close_ts even before anyone closes the round", async () => {
      await waitUntilChainTime((await round(id)).closeTs);
      await expectError(send([tunnel.deployParticles({ owner: u1.publicKey, roundId: id, barrier: 0, count: 1 })], [u1]), "RoundExpired");
    });

    it("closes, fixes the VRF seed, and requests ORAO randomness", async () => {
      await send([tunnel.closeRound(id)]);
      let r = await round(id);
      expect(r.status).to.equal("closed");
      expect(r.vrfSeed.some((b) => b !== 0)).to.be.true;
      await expectError(send([tunnel.closeRound(id)]), "RoundNotOpen");
      await send([tunnel.requestRandomness({ cranker: admin.publicKey, roundId: id, vrfSeed: r.vrfSeed, vrfTreasury: vrfTreasury.publicKey })]);
      r = await round(id);
      expect(r.status).to.equal("awaitingRandomness");
    });

    it("cannot reveal before ORAO fulfills", async () => {
      const r = await round(id);
      await expectError(send([tunnel.revealRandomness(id, r.vrfSeed)]), "RandomnessNotFulfilled");
    });

    it("rejects a randomness account for a different seed", async () => {
      const ix = tunnel.revealRandomness(id, new Uint8Array(32).fill(5));
      await expectError(send([ix]), "ConstraintSeeds");
    });

    it("reveals fulfilled randomness", async () => {
      const r0 = await round(id);
      await fulfill(r0.vrfSeed);
      await send([tunnel.revealRandomness(id, r0.vrfSeed)]);
      const r = await round(id);
      expect(r.status).to.equal("resolving");
      const onOrao = await vrf.getRandomness(r.vrfSeed);
      expect(Buffer.from(r.randomness).equals(Buffer.from(onOrao.getFulfilledRandomness()!))).to.be.true;
    });

    it("refuses to finalize until every position is settled", async () => {
      await expectError(send([tunnel.finalizeRound(id)]), "PositionsPending");
    });

    it("settles each position exactly once, matching the SDK's independent derivation", async () => {
      for (const u of [u1, u2, u3]) await send([tunnel.settlePosition(id, u.publicKey)]);
      await expectError(send([tunnel.settlePosition(id, u1.publicKey)]), "PositionAlreadySettled");
      const v = verifyRound(await round(id), await fetchRoundPositions(connection, id, programId));
      expect(v.positions.every((p) => p.matches)).to.be.true;
      expect(v.totalWeightMatches).to.be.true;
    });

    it("blocks claims before finalization", async () => {
      await expectError(send([tunnel.claim({ owner: u1.publicKey, roundId: id, tunnelMint: mint })], [u1]), "RoundNotSettled");
    });

    it("pays exactly 5% into the rent-exempt treasury vault, once", async () => {
      const vault = treasuryVaultPda(programId);
      const before = BigInt(await connection.getBalance(vault));
      await send([tunnel.finalizeRound(id)]);
      const r = await round(id);
      const { fee, distributable } = splitFee(r.totalLamports, 500);
      expect(BigInt(await connection.getBalance(vault)) - before).to.equal(fee);
      expect(r.status).to.equal("settled");
      expect(r.distributableLamports).to.equal(distributable);
      expect(r.outcome).to.equal(r.totalSuccessWeight > 0n ? "rewards" : "noSuccessRefund");
      await expectError(send([tunnel.finalizeRound(id)]), "NotResolving");
    });

    it("forwards fees only to the configured treasury", async () => {
      await expectError(send([tunnel.withdrawFees(attacker.publicKey)]), "TreasuryMismatch");
      const before = BigInt(await connection.getBalance(treasury.publicKey));
      const vaultBefore = BigInt(await connection.getBalance(treasuryVaultPda(programId)));
      await send([tunnel.withdrawFees(treasury.publicKey)], []); // permissionless (fee payer: provider)
      const rentFloor = BigInt(await connection.getMinimumBalanceForRentExemption(9));
      expect(BigInt(await connection.getBalance(treasury.publicKey)) - before).to.equal(vaultBefore - rentFloor);
      expect(BigInt(await connection.getBalance(treasuryVaultPda(programId)))).to.equal(rentFloor);
    });

    it("blocks another wallet from claiming someone else's position", async () => {
      const ix = tunnel.claim({ owner: attacker.publicKey, roundId: id, tunnelMint: mint });
      const victim = tunnel.claim({ owner: u1.publicKey, roundId: id, tunnelMint: mint });
      ix.keys[4] = victim.keys[4]; // u1's position, attacker signing
      await expectError(send([ix], [attacker]), "ConstraintSeeds");
    });

    it("pays every claim exactly what the SDK computes, closes the position, and cannot pay twice", async () => {
      const r = await round(id);
      expect(verifyRound(r, await fetchRoundPositions(connection, id, programId)).allMatch).to.be.true;
      let paid = 0n;
      for (const u of [u1, u2, u3]) {
        const pos = (await fetchPosition(connection, id, u.publicKey, programId))!;
        const rent = BigInt(await connection.getBalance(positionPda(id, u.publicKey, programId)));
        const expected = computePayout({
          outcome: r.outcome,
          distributableLamports: r.distributableLamports,
          totalLamports: r.totalLamports,
          totalSuccessWeight: r.totalSuccessWeight,
          emissionBudget: r.emissionBudget,
          positionLamports: pos.lamports,
          positionSuccessWeight: pos.successWeight,
        })!;
        const tokBefore = await tokenBalance(u.publicKey);
        const claimed = await claimAndRead(u, id);
        expect(claimed.lamports).to.equal(expected.lamports);
        expect(claimed.tokens).to.equal(expected.tokens);
        expect((await tokenBalance(u.publicKey)) - tokBefore).to.equal(expected.tokens);
        expect(await connection.getAccountInfo(positionPda(id, u.publicKey, programId))).to.be.null; // rent returned
        expect(rent > 0n).to.be.true;
        paid += expected.lamports;
        await expectError(send([tunnel.claim({ owner: u.publicKey, roundId: id, tunnelMint: mint })], [u]), "AccountNotInitialized");
      }
      const after = await round(id);
      expect(after.claims).to.equal(3);
      expect(after.lamportsClaimed).to.equal(paid);
      expect(paid <= r.distributableLamports).to.be.true;
      expect(r.distributableLamports - paid < 3n).to.be.true; // at most 1 lamport of dust per participant
    });

    it("sweeps rounding dust to the treasury vault and closes the escrow", async () => {
      await send([tunnel.sweepRound(id)]);
      expect(await connection.getAccountInfo(roundVaultPda(id, programId))).to.be.null;
      expect((await round(id)).swept).to.be.true;
    });
  });

  describe("round B (pre-scheduled) — empty round", () => {
    it("settles with no participants and returns its emission to the reserve", async () => {
      const id = (await protocol()).nextRoundId - 1n;
      const before = (await protocol()).reserveAvailable;
      const r0 = await round(id);
      await waitUntilChainTime(r0.closeTs);
      await send([tunnel.closeRound(id)]);
      const r = await round(id);
      expect(r.status).to.equal("settled");
      expect(r.outcome).to.equal("empty");
      expect((await protocol()).reserveAvailable - before).to.equal(r0.emissionBudget);
      await send([tunnel.sweepRound(id)]);
    });
  });

  describe("round C — nobody tunnels: 95% refund, emission returned", () => {
    it("refunds the distributable pool pro rata", async function () {
      const allFail = { ...TEST_PARAMS, barriers: TEST_PARAMS.barriers.map((b) => ({ ...b, transmissionBps: 1 })) as ProtocolParams["barriers"] };
      await send([tunnel.updateParams(admin.publicKey, allFail)]);
      const id = await openRound();
      await send([tunnel.updateParams(admin.publicKey, TEST_PARAMS)]);
      await send([tunnel.deployParticles({ owner: u1.publicKey, roundId: id, barrier: 0, count: 3 })], [u1]);
      await send([tunnel.deployParticles({ owner: u2.publicKey, roundId: id, barrier: 2, count: 1 })], [u2]);
      const reserveBefore = (await protocol()).reserveAvailable;
      const r = await resolveRound(id);
      // P(any success) = 1 - (1 - 0.0001)^4 ≈ 0.04%: verify the program agrees with the SDK either way.
      if (r.totalSuccessWeight > 0n) this.skip();
      expect(r.outcome).to.equal("noSuccessRefund");
      expect((await protocol()).reserveAvailable - reserveBefore).to.equal(r.emissionBudget);
      const balBefore = BigInt(await connection.getBalance(u1.publicKey));
      const rent = BigInt(await connection.getBalance(positionPda(id, u1.publicKey, programId)));
      const claimed = await claimAndRead(u1, id);
      expect(claimed.lamports).to.equal((30_000_000n * 95n) / 100n);
      expect(claimed.tokens).to.equal(0n);
      // refund + returned position rent − transaction fee (ATA already exists from round A)
      expect(BigInt(await connection.getBalance(u1.publicKey)) - balBefore).to.equal(claimed.lamports + rent - claimed.fee);
    });
  });

  describe("round D — randomness never arrives: full refund", () => {
    it("fails after the timeout and refunds 100% with no fee", async () => {
      const id = await openRound();
      await send([tunnel.deployParticles({ owner: u3.publicKey, roundId: id, barrier: 1, count: 4 })], [u3]);
      const r0 = await round(id);
      await waitUntilChainTime(r0.closeTs);
      await send([tunnel.closeRound(id)]);
      const closed = await round(id);
      await send([tunnel.requestRandomness({ cranker: admin.publicKey, roundId: id, vrfSeed: closed.vrfSeed, vrfTreasury: vrfTreasury.publicKey })]);
      await expectError(send([tunnel.recoverRound(id, closed.vrfSeed)]), "RecoveryNotAvailable");
      const requested = await round(id);
      await waitUntilChainTime(requested.randomnessRequestedTs + 121);
      const treasuryBefore = await connection.getBalance(treasuryVaultPda(programId));
      await send([tunnel.recoverRound(id, closed.vrfSeed)]);
      const r = await round(id);
      expect(r.status).to.equal("failed");
      expect(r.outcome).to.equal("fullRefund");
      expect(r.feeLamports).to.equal(0n);
      expect(await connection.getBalance(treasuryVaultPda(programId))).to.equal(treasuryBefore);
      const claimed = await claimAndRead(u3, id);
      expect(claimed.lamports).to.equal(40_000_000n);
      // Late fulfillment cannot resurrect a failed round.
      await fulfill(closed.vrfSeed);
      await expectError(send([tunnel.revealRandomness(id, closed.vrfSeed)]), "NotAwaitingRandomness");
    });
  });

  describe("round E — fulfilled randomness cannot be dodged by recovery", () => {
    it("refuses recover_round once ORAO has fulfilled, even after the timeout", async () => {
      const id = await openRound();
      await send([tunnel.deployParticles({ owner: u2.publicKey, roundId: id, barrier: 2, count: 1 })], [u2]);
      await waitUntilChainTime((await round(id)).closeTs);
      await send([tunnel.closeRound(id)]);
      const closed = await round(id);
      await send([tunnel.requestRandomness({ cranker: admin.publicKey, roundId: id, vrfSeed: closed.vrfSeed, vrfTreasury: vrfTreasury.publicKey })]);
      await fulfill(closed.vrfSeed);
      await waitUntilChainTime((await round(id)).randomnessRequestedTs + 121);
      await expectError(send([tunnel.recoverRound(id, closed.vrfSeed)]), "RandomnessAvailable");
      await send([tunnel.revealRandomness(id, closed.vrfSeed)]);
      expect((await round(id)).status).to.equal("resolving");
    });
  });

  describe("reserve cap", () => {
    it("never commits more $TUNNEL than the reserve holds", async () => {
      const huge = { ...TEST_PARAMS, initialEmissionPerRound: TUNNEL_TOTAL_SUPPLY * 2n };
      await send([tunnel.updateParams(admin.publicKey, huge)]);
      const available = (await protocol()).reserveAvailable;
      const id = await openRound();
      expect((await round(id)).emissionBudget).to.equal(available);
      expect((await protocol()).reserveAvailable).to.equal(0n);
      await send([tunnel.updateParams(admin.publicKey, TEST_PARAMS)]);
      await waitUntilChainTime((await round(id)).closeTs);
      await send([tunnel.closeRound(id)]); // empty: budget returns
      expect((await protocol()).reserveAvailable).to.equal(available);
    });
  });

  describe("administration", () => {
    it("transfers admin in two steps", async () => {
      const next = await newUser(1);
      await send([tunnel.proposeAdmin(admin.publicKey, next.publicKey)]);
      await expectError(send([tunnel.acceptAdmin(attacker.publicKey)], [attacker]), "NotPendingAdmin");
      await send([tunnel.acceptAdmin(next.publicKey)], [next]);
      expect((await protocol()).admin.equals(next.publicKey)).to.be.true;
      await send([tunnel.proposeAdmin(next.publicKey, admin.publicKey)], [next]);
      await send([tunnel.acceptAdmin(admin.publicKey)]);
    });

    it("exposes no instruction that lets the admin move escrow or the reserve", () => {
      const names = IDL.instructions.map((i) => i.name);
      const adminGated = ["update_params", "set_paused", "set_treasury", "propose_admin"];
      for (const n of adminGated) expect(names).to.include(n);
      expect(names.filter((n) => /withdraw|drain|emergency/.test(n))).to.deep.equal([]);
    });
  });

  after(async () => {
    const p = await protocol();
    console.log(`
  protocol: ${p.roundsSettled} rounds settled, ${p.totalParticles} particles, fees ${p.totalFeesLamports} lamports`);
  });
});
