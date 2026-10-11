/**
 * TUNNEL Anchor integration tests (localnet).
 *
 * The local validator clones the real ORAO VRF program from devnet and this
 * suite initialises a local ORAO network state with its own fulfillment key,
 * so randomness is produced by the actual ORAO program logic, just signed by a
 * key we control. Every odds table, particle outcome and payout is recomputed
 * independently with the SDK and compared to what the program did onchain.
 *
 * Run: `anchor test` (needs Solana CLI + Anchor 0.32.1; see docs/DEPLOYMENT.md).
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { FulfillBuilder, InitBuilder, Orao } from "@orao-network/solana-vrf";
import { createMint, getAccount, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { assert, expect } from "chai";
import nacl from "tweetnacl";
import {
  DEFAULT_PARAMS,
  IDL,
  TUNNEL_DECIMALS,
  TUNNEL_UNIT,
  TunnelInstructions,
  computePayout,
  deriveOdds,
  fetchCycle,
  fetchCyclePositions,
  fetchPosition,
  fetchProtocol,
  mulDiv,
  parseEvents,
  positionPda,
  verifyCycle,
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

const TEST_PARAMS: ProtocolParams = { ...DEFAULT_PARAMS, cycleDurationSecs: 30, randomnessTimeoutSecs: 120 };
const RESERVE = 1_000_000n * TUNNEL_UNIT;
let mint: PublicKey;

// ---------------------------------------------------------------- helpers

const isBlockhashError = (e: unknown) => /Blockhash not found|block height exceeded|BlockheightExceeded/i.test(String((e as Error)?.message ?? e));

/** Sends with a "confirmed" blockhash and retries only on blockhash expiry (slow local validators). */
async function send(ixs: TransactionInstruction[], signers: Keypair[] = [], feePayer: Keypair = admin): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: feePayer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
      const all = [feePayer, ...signers.filter((k) => !k.publicKey.equals(feePayer.publicKey))];
      tx.sign(...all);
      const sig = await connection.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
      const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      if (res.value.err) throw new Error(`transaction failed: ${JSON.stringify(res.value.err)}`);
      return sig;
    } catch (e) {
      if (attempt < 6 && isBlockhashError(e)) {
        await new Promise((r) => setTimeout(r, 750));
        continue;
      }
      throw e;
    }
  }
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

async function newUser(sol = 5) {
  const kp = Keypair.generate();
  const sig = await connection.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
  return kp;
}

const protocol = async () => (await fetchProtocol(connection, programId))!;
const cycle = async (id: bigint) => (await fetchCycle(connection, id, programId))!;

async function openCycle() {
  const p = await protocol();
  await send([tunnel.openCycle(admin.publicKey, p.nextCycleId)]);
  return p.nextCycleId;
}

/** A deployment paid and signed by the user themself (as in the app). */
async function deploy(user: Keypair, cycleId: bigint, barrier: number, level: number, count: number, gatekeeper?: Keypair) {
  const ix = tunnel.deployParticles({ owner: user.publicKey, cycleId, barrier, level, count, gatekeeper: gatekeeper?.publicKey });
  const sig = await send([ix], gatekeeper ? [gatekeeper] : [], user);
  const tx = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  return parseEvents(programId, tx!.meta!.logMessages!).find((e) => e.name === "ParticlesDeployed")!.data;
}

async function fulfill(seed: Uint8Array) {
  const signature = nacl.sign.detached(seed, fulfillmentAuthority.secretKey);
  for (let attempt = 1; ; attempt++) {
    try {
      await new FulfillBuilder(vrf, seed).withComputeUnitPrice(0n).rpc(fulfillmentAuthority.publicKey, signature);
      return;
    } catch (e) {
      if (attempt < 6 && isBlockhashError(e)) continue;
      throw e;
    }
  }
}

async function closeAndRequest(id: bigint) {
  await waitUntilChainTime((await cycle(id)).closeTs);
  await send([tunnel.closeCycle(id)]);
  const closed = await cycle(id);
  await send([tunnel.requestRandomness({ cranker: admin.publicKey, cycleId: id, vrfSeed: closed.vrfSeed, vrfTreasury: vrfTreasury.publicKey })]);
  return closed;
}

const settleIx = (id: bigint, owner: PublicKey) => [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), tunnel.settlePosition(id, owner)];

/** close → request → fulfill → reveal → settle all → finalize */
async function resolveCycle(id: bigint) {
  const closed = await closeAndRequest(id);
  await fulfill(closed.vrfSeed);
  await send([tunnel.revealRandomness(id, closed.vrfSeed)]);
  for (const p of await fetchCyclePositions(connection, id, programId)) await send(settleIx(id, p.owner));
  await send([tunnel.finalizeCycle(id)]);
  return cycle(id);
}

/** Claims and returns what the program paid, read from the RewardClaimed event in the tx logs. */
async function claimAndRead(user: Keypair, cycleId: bigint, expectsTokens: boolean) {
  const sig = await send(tunnel.claim({ owner: user.publicKey, cycleId, tunnelMint: mint, expectsTokens }), [], user);
  const tx = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const ev = parseEvents(programId, tx!.meta!.logMessages!).find((e) => e.name === "RewardClaimed")!;
  return { sig, tokens: BigInt(ev.data.tokens.toString()) };
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
  const gatekeeper = Keypair.generate();

  before(async () => {
    await new InitBuilder(vrf, admin.publicKey, vrfTreasury.publicKey, [fulfillmentAuthority.publicKey], new BN(1_000_000)).rpc();
    [u1, u2, u3, attacker] = await Promise.all([newUser(), newUser(), newUser(), newUser()]);
    await connection.confirmTransaction(await connection.requestAirdrop(vrfTreasury.publicKey, LAMPORTS_PER_SOL), "confirmed");
    mint = await createMint(connection, admin, admin.publicKey, null, TUNNEL_DECIMALS);
    const adminAta = await getOrCreateAssociatedTokenAccount(connection, admin, mint, admin.publicKey);
    await mintTo(connection, admin, mint, adminAta.address, admin, RESERVE * 2n);
  });

  describe("initialization", () => {
    it("rejects initialization by anyone other than the upgrade authority", async () => {
      const ix = tunnel.initialize({ admin: attacker.publicKey, tunnelMint: mint, params: TEST_PARAMS });
      await expectError(send([ix], [attacker]), "Unauthorized");
    });

    it("rejects invalid parameters and physically opaque barriers", async () => {
      const aboveBarrier = { ...TEST_PARAMS, levels: [{ energyBps: 10_000, cost: 1 }, ...TEST_PARAMS.levels.slice(1)] };
      await expectError(send([tunnel.initialize({ admin: admin.publicKey, tunnelMint: mint, params: aboveBarrier })]), "InvalidParams");
      const opaque = { ...TEST_PARAMS, barriers: [TEST_PARAMS.barriers[0], TEST_PARAMS.barriers[1], { heightMilli: 20_000, widthMilli: 5_000, rewardPremiumBps: 10_000 }] as ProtocolParams["barriers"] };
      const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
      await expectError(send([cu, tunnel.initialize({ admin: admin.publicKey, tunnelMint: mint, params: opaque })]), "InvalidParams");
    });

    it("initializes and derives the odds table from the physics model onchain", async () => {
      const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
      const sig = await send([cu, tunnel.initialize({ admin: admin.publicKey, tunnelMint: mint, params: TEST_PARAMS })]);
      const tx = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      console.log(`      initialize used ${tx!.meta!.computeUnitsConsumed} CU (soft-float physics)`);
      const p = await protocol();
      expect(p.admin.equals(admin.publicKey)).to.equal(true);
      expect(p.gatekeeper.equals(PublicKey.default)).to.equal(true);
      expect(p.params).to.deep.equal(TEST_PARAMS);
      // The program's soft-float derivation equals the SDK's (V8) derivation exactly.
      expect(p.odds).to.deep.equal(deriveOdds(TEST_PARAMS));
    });

    it("cannot be initialized twice", async () => {
      const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
      await expectError(send([cu, tunnel.initialize({ admin: admin.publicKey, tunnelMint: mint, params: TEST_PARAMS })]), "already in use");
    });

    it("funds the emissions reserve", async () => {
      const adminAta = getAssociatedTokenAddressSync(mint, admin.publicKey);
      await send([tunnel.fundReserve({ funder: admin.publicKey, tunnelMint: mint, funderTokenAccount: adminAta, amount: RESERVE })]);
      const p = await protocol();
      expect(p.reserveAvailable).to.equal(RESERVE);
      expect((await getAccount(connection, p.rewardVault)).amount).to.equal(RESERVE);
    });
  });

  describe("cycle A — deployments, settlement, rewards, claims", () => {
    let id: bigint;

    it("opens a cycle with a snapshot and emission budget", async () => {
      id = await openCycle();
      const c = await cycle(id);
      expect(c.status).to.equal("open");
      expect(c.odds).to.deep.equal((await protocol()).odds);
      expect(c.energyPerCycle).to.equal(100);
      expect(c.emissionBudget).to.equal(TEST_PARAMS.initialEmissionPerCycle);
      expect((await protocol()).reserveAvailable).to.equal(RESERVE - c.emissionBudget);
    });

    it("rejects scheduling a second upcoming cycle and deployments into it", async () => {
      const next = await openCycle(); // the one after A: allowed (A already started)
      await expectError(send([tunnel.openCycle(admin.publicKey, next + 1n)]), "CycleScheduleConflict");
      await expectError(deploy(u1, next, 0, 0, 1), "CycleNotStarted");
    });

    it("accepts experiments from several wallets, drawing from each wallet's energy", async () => {
      const e1 = await deploy(u1, id, 0, 0, 10); // 10 × cost 1
      expect(e1.first_index).to.equal(0);
      expect(e1.energy_used).to.equal(10);
      expect(e1.experiment).to.equal(0);
      const e2 = await deploy(u1, id, 0, 0, 5); // same cell: indices continue
      expect(e2.first_index).to.equal(10);
      expect(e2.experiment).to.equal(1);
      await deploy(u1, id, 2, 4, 3); // high barrier, E5: 3 × 5
      await deploy(u2, id, 1, 2, 20); // medium, E3: 20 × 3 = 60
      await deploy(u3, id, 2, 0, 40); // high, E1
      const pos = (await fetchPosition(connection, id, u1.publicKey, programId))!;
      expect(pos.energyUsed).to.equal(10 + 5 + 15);
      expect(pos.particles[0][0]).to.equal(15);
      expect(pos.particles[2][4]).to.equal(3);
      const c = await cycle(id);
      expect(c.participants).to.equal(3);
      expect(c.experiments).to.equal(5);
      expect(c.particles).to.deep.equal([15n, 20n, 43n]);
      expect(c.energyUsed).to.equal(30n + 60n + 40n);
    });

    it("enforces the per-cycle energy allowance and validates inputs", async () => {
      await expectError(deploy(u2, id, 1, 2, 14), "EnergyExhausted"); // 60 + 42 > 100
      await deploy(u2, id, 1, 2, 13); // exactly 99
      await expectError(deploy(u2, id, 0, 0, 2), "EnergyExhausted");
      await expectError(deploy(u1, id, 3, 0, 1), "InvalidBarrier");
      await expectError(deploy(u1, id, 0, 5, 1), "InvalidLevel");
      await expectError(deploy(u1, id, 0, 0, 0), "ZeroParticles");
    });

    it("requires the gatekeeper's co-signature only while one is configured", async () => {
      await send([tunnel.setGatekeeper(admin.publicKey, gatekeeper.publicKey)]);
      await expectError(deploy(u3, id, 0, 0, 1), "GatekeeperRequired");
      await expectError(deploy(u3, id, 0, 0, 1, attacker), "GatekeeperRequired");
      await deploy(u3, id, 0, 0, 1, gatekeeper);
      await send([tunnel.setGatekeeper(admin.publicKey, PublicKey.default)]);
      await deploy(u3, id, 0, 0, 1);
      await expectError(send([tunnel.setGatekeeper(attacker.publicKey, attacker.publicKey)], [attacker]), "Unauthorized");
    });

    it("blocks deployments while paused and resumes after", async () => {
      await send([tunnel.setPaused(admin.publicKey, true)]);
      await expectError(deploy(u3, id, 0, 0, 1), "Paused");
      await send([tunnel.setPaused(admin.publicKey, false)]);
    });

    it("re-derives odds on parameter updates but never changes an open cycle's snapshot", async () => {
      const before = await cycle(id);
      const changed = { ...TEST_PARAMS, barriers: [{ ...TEST_PARAMS.barriers[0], widthMilli: 1_100 }, TEST_PARAMS.barriers[1], TEST_PARAMS.barriers[2]] as ProtocolParams["barriers"] };
      await send([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), tunnel.updateParams(admin.publicKey, changed)]);
      expect((await protocol()).odds).to.deep.equal(deriveOdds(changed));
      expect((await cycle(id)).odds).to.deep.equal(before.odds);
      await send([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), tunnel.updateParams(admin.publicKey, TEST_PARAMS)]);
    });

    it("rejects parameter updates from non-admins", async () => {
      await expectError(send([tunnel.updateParams(attacker.publicKey, TEST_PARAMS)], [attacker]), "Unauthorized");
    });

    it("cannot be closed early, and rejects late deployments even before anyone closes it", async () => {
      await expectError(send([tunnel.closeCycle(id)]), "CycleStillOpen");
      await waitUntilChainTime((await cycle(id)).closeTs);
      await expectError(deploy(u3, id, 0, 0, 1), "CycleExpired");
    });

    it("closes, fixes the VRF seed and requests ORAO randomness; cannot reveal before fulfillment", async () => {
      const closed = await closeAndRequest(id);
      expect(closed.vrfSeed.some((b) => b !== 0)).to.equal(true);
      expect((await cycle(id)).status).to.equal("awaitingRandomness");
      await expectError(send([tunnel.revealRandomness(id, closed.vrfSeed)]), "RandomnessNotFulfilled");
      await expectError(send([tunnel.revealRandomness(id, new Uint8Array(32).fill(5))]), "ConstraintSeeds");
      await fulfill(closed.vrfSeed);
      await send([tunnel.revealRandomness(id, closed.vrfSeed)]);
      expect((await cycle(id)).status).to.equal("resolving");
    });

    it("settles each position exactly once, matching the SDK's independent derivation", async () => {
      await expectError(send([tunnel.finalizeCycle(id)]), "PositionsPending");
      for (const u of [u1, u2, u3]) await send(settleIx(id, u.publicKey));
      await expectError(send(settleIx(id, u1.publicKey)), "PositionAlreadySettled");
      const c = await cycle(id);
      const v = verifyCycle(c, await fetchCyclePositions(connection, id, programId));
      expect(v.oddsMatchPhysics).to.equal(true);
      expect(v.positions.every((p) => p.matches)).to.equal(true);
      expect(v.totalNominalMatches).to.equal(true);
    });

    it("blocks claims before finalization", async () => {
      await expectError(claimAndRead(u1, id, true), "CycleNotSettled");
    });

    it("finalizes to min(Σ nominal, budget) and returns any unused budget to the reserve", async () => {
      const reserveBefore = (await protocol()).reserveAvailable;
      await send([tunnel.finalizeCycle(id)]);
      await expectError(send([tunnel.finalizeCycle(id)]), "NotResolving");
      const c = await cycle(id);
      const allocated = c.totalNominal < c.emissionBudget ? c.totalNominal : c.emissionBudget;
      expect(c.tokensAllocated).to.equal(allocated);
      expect((await protocol()).reserveAvailable).to.equal(reserveBefore + (c.emissionBudget - allocated));
      expect(c.outcome).to.equal(c.successes.some((s) => s > 0n) ? "rewards" : "noTunnels");
    });

    it("blocks another wallet from claiming someone else's position", async () => {
      const ix = tunnel.claim({ owner: attacker.publicKey, cycleId: id, tunnelMint: mint, expectsTokens: false })[0];
      ix.keys[3].pubkey = positionPda(id, u1.publicKey, programId);
      await expectError(send([ix], [], attacker), "ConstraintSeeds");
    });

    it("pays every claim exactly what the SDK computes, refunds rent, and cannot pay twice", async () => {
      const c = await cycle(id);
      for (const u of [u1, u2, u3]) {
        const pos = (await fetchPosition(connection, id, u.publicKey, programId))!;
        const expected = computePayout({ outcome: c.outcome, totalNominal: c.totalNominal, emissionBudget: c.emissionBudget, positionNominal: pos.nominalReward });
        const before = await tokenBalance(u.publicKey);
        const lamportsBefore = await connection.getBalance(u.publicKey);
        const { tokens } = await claimAndRead(u, id, expected > 0n);
        expect(tokens).to.equal(expected);
        expect((await tokenBalance(u.publicKey)) - before).to.equal(expected);
        expect(await connection.getAccountInfo(pos.address)).to.equal(null);
        if (expected === 0n) expect(await connection.getBalance(u.publicKey)).to.be.greaterThan(lamportsBefore); // rent refunded > fee
        await expectError(claimAndRead(u, id, expected > 0n), "AccountNotInitialized");
      }
      expect((await protocol()).totalTokensClaimed).to.equal((await cycle(id)).tokensClaimed);
    });

    it("sweeps rounding dust back to the reserve once everyone has claimed", async () => {
      const reserveBefore = (await protocol()).reserveAvailable;
      const c = await cycle(id);
      await send([tunnel.sweepCycle(id)]);
      expect((await protocol()).reserveAvailable).to.equal(reserveBefore + (c.tokensAllocated - c.tokensClaimed));
      await expectError(send([tunnel.sweepCycle(id)]), "AlreadySwept");
    });
  });

  describe("cycle B (pre-scheduled) — empty cycle", () => {
    it("settles with no participants and returns its budget to the reserve", async () => {
      const id = (await protocol()).nextCycleId - 1n;
      const c0 = await cycle(id);
      const reserveBefore = (await protocol()).reserveAvailable;
      await waitUntilChainTime(c0.closeTs);
      await send([tunnel.closeCycle(id)]);
      const c = await cycle(id);
      expect(c.status).to.equal("settled");
      expect(c.outcome).to.equal("empty");
      expect((await protocol()).reserveAvailable).to.equal(reserveBefore + c0.emissionBudget);
    });
  });

  describe("cycle C — emission cap: rewards scale down pro rata", () => {
    it("never pays more than the cycle budget", async () => {
      // A budget far below what three wallets' high-barrier experiments can earn.
      const tiny = { ...TEST_PARAMS, initialEmissionPerCycle: 3n * TUNNEL_UNIT };
      await send([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), tunnel.updateParams(admin.publicKey, tiny)]);
      const id = await openCycle();
      for (const u of [u1, u2, u3]) await deploy(u, id, 0, 4, 20); // low barrier, E5: ~79% each
      const c = await resolveCycle(id);
      expect(c.outcome).to.equal("rewards");
      expect(c.totalNominal > c.emissionBudget).to.equal(true);
      expect(c.tokensAllocated).to.equal(c.emissionBudget);
      let paid = 0n;
      for (const u of [u1, u2, u3]) {
        const pos = (await fetchPosition(connection, id, u.publicKey, programId))!;
        const { tokens } = await claimAndRead(u, id, pos.nominalReward > 0n);
        expect(tokens).to.equal(mulDiv(c.emissionBudget, pos.nominalReward, c.totalNominal));
        paid += tokens;
      }
      expect(paid <= c.emissionBudget).to.equal(true);
      expect(c.emissionBudget - paid <= 3n).to.equal(true);
      await send([tunnel.sweepCycle(id)]);
      await send([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), tunnel.updateParams(admin.publicKey, TEST_PARAMS)]);
    });
  });

  describe("cycle D — randomness never arrives: cycle is voided", () => {
    it("voids after the timeout, pays nothing, returns the budget and lets positions close", async () => {
      const id = await openCycle();
      await deploy(u1, id, 1, 1, 5);
      const closed = await closeAndRequest(id);
      await expectError(send([tunnel.voidCycle(id, closed.vrfSeed)]), "RecoveryNotAvailable");
      const reserveBefore = (await protocol()).reserveAvailable;
      await waitUntilChainTime((await cycle(id)).randomnessRequestedTs + 121);
      await send([tunnel.voidCycle(id, closed.vrfSeed)]);
      const c = await cycle(id);
      expect(c.status).to.equal("void");
      expect((await protocol()).reserveAvailable).to.equal(reserveBefore + c.emissionBudget);
      // A late fulfillment cannot revive it.
      await fulfill(closed.vrfSeed);
      await expectError(send([tunnel.revealRandomness(id, closed.vrfSeed)]), "NotAwaitingRandomness");
      const { tokens } = await claimAndRead(u1, id, false);
      expect(tokens).to.equal(0n);
      await send([tunnel.sweepCycle(id)]);
    });
  });

  describe("cycle E — fulfilled randomness cannot be discarded", () => {
    it("refuses void_cycle once ORAO has fulfilled, even after the timeout", async () => {
      const id = await openCycle();
      await deploy(u2, id, 2, 0, 1);
      const closed = await closeAndRequest(id);
      await fulfill(closed.vrfSeed);
      await waitUntilChainTime((await cycle(id)).randomnessRequestedTs + 121);
      await expectError(send([tunnel.voidCycle(id, closed.vrfSeed)]), "RandomnessAvailable");
      await send([tunnel.revealRandomness(id, closed.vrfSeed)]);
      await send(settleIx(id, u2.publicKey));
      await send([tunnel.finalizeCycle(id)]);
      const c = await cycle(id);
      const pos = (await fetchPosition(connection, id, u2.publicKey, programId))!;
      expect(c.outcome).to.equal(pos.nominalReward > 0n ? "rewards" : "noTunnels");
      await claimAndRead(u2, id, pos.nominalReward > 0n);
    });
  });

  describe("reserve cap", () => {
    it("never commits more $TUNNEL than the reserve holds", async () => {
      const huge = { ...TEST_PARAMS, initialEmissionPerCycle: RESERVE * 10n };
      await send([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), tunnel.updateParams(admin.publicKey, huge)]);
      const p0 = await protocol();
      await waitUntilChainTime(p0.lastCycleCloseTs);
      const id = await openCycle();
      expect((await cycle(id)).emissionBudget).to.equal(p0.reserveAvailable);
      expect((await protocol()).reserveAvailable).to.equal(0n);
      await send([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), tunnel.updateParams(admin.publicKey, TEST_PARAMS)]);
    });
  });

  describe("administration", () => {
    it("transfers admin in two steps", async () => {
      const next = Keypair.generate();
      await send([tunnel.proposeAdmin(admin.publicKey, next.publicKey)]);
      await expectError(send([tunnel.acceptAdmin(attacker.publicKey)], [attacker]), "NotPendingAdmin");
      await send([tunnel.acceptAdmin(next.publicKey)], [next]);
      expect((await protocol()).admin.equals(next.publicKey)).to.equal(true);
      await send([tunnel.proposeAdmin(next.publicKey, admin.publicKey)], [next]);
      await send([tunnel.acceptAdmin(admin.publicKey)]);
    });

    it("exposes no instruction that moves the reserve except user claims", () => {
      // initialize creates the (empty) vault; fund_reserve only adds; claim pays a settled position.
      const touchesVault = IDL.instructions.filter((i) => i.accounts.some((a) => (a as { name: string }).name === "reward_vault" && (a as { writable?: boolean }).writable));
      expect(touchesVault.map((i) => i.name).sort()).to.deep.equal(["claim", "fund_reserve", "initialize"]);
    });
  });
});
