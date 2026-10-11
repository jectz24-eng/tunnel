/**
 * Instruction builders. Every TUNNEL instruction the app, keeper, scripts and
 * tests send is built here, with accounts ordered from the IDL.
 */
import BN from "bn.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";
import { IDL, coder } from "./accounts";
import { ORAO_VRF_PROGRAM_ID, TUNNEL_PROGRAM_ID, type ProtocolParams } from "./constants";
import { cyclePda, oraoNetworkStatePda, oraoRandomnessPda, positionPda, protocolPda, rewardVaultPda } from "./pda";

const BPF_UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

type AccountMap = Record<string, PublicKey | null | undefined>;

function build(name: string, accounts: AccountMap, args: Record<string, unknown>, programId: PublicKey): TransactionInstruction {
  const def = IDL.instructions.find((i) => i.name === name);
  if (!def) throw new Error(`unknown instruction ${name}`);
  const keys = def.accounts.map((a) => {
    const acc = a as { name: string; writable?: boolean; signer?: boolean; optional?: boolean };
    const pubkey = accounts[acc.name];
    if (!pubkey) {
      // Anchor encodes an absent optional account as the program id.
      if (acc.optional) return { pubkey: programId, isWritable: false, isSigner: false };
      throw new Error(`${name}: missing account ${acc.name}`);
    }
    return { pubkey, isWritable: !!acc.writable, isSigner: !!acc.signer };
  });
  return new TransactionInstruction({ programId, keys, data: coder.instruction.encode(name, args) });
}

const bn = (v: bigint | number) => new BN(v.toString());

export function encodeParams(p: ProtocolParams) {
  return {
    barriers: p.barriers.map((b) => ({ height_milli: b.heightMilli, width_milli: b.widthMilli, reward_premium_bps: b.rewardPremiumBps })),
    levels: p.levels.map((l) => ({ energy_bps: l.energyBps, cost: l.cost })),
    energy_per_cycle: p.energyPerCycle,
    reward_per_energy: bn(p.rewardPerEnergy),
    cycle_duration_secs: p.cycleDurationSecs,
    randomness_timeout_secs: p.randomnessTimeoutSecs,
    initial_emission_per_cycle: bn(p.initialEmissionPerCycle),
    emission_decay_bps: p.emissionDecayBps,
    emission_epoch_cycles: p.emissionEpochCycles,
  };
}

export class TunnelInstructions {
  constructor(readonly programId: PublicKey = TUNNEL_PROGRAM_ID) {}

  private get protocol() {
    return protocolPda(this.programId);
  }

  // ---- administration ----

  initialize(a: { admin: PublicKey; tunnelMint: PublicKey; gatekeeper?: PublicKey; params: ProtocolParams }) {
    const [programData] = PublicKey.findProgramAddressSync([this.programId.toBytes()], BPF_UPGRADEABLE_LOADER);
    return build(
      "initialize",
      {
        admin: a.admin,
        protocol: this.protocol,
        tunnel_mint: a.tunnelMint,
        reward_vault: rewardVaultPda(this.programId),
        program: this.programId,
        program_data: programData,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
      },
      { gatekeeper: a.gatekeeper ?? PublicKey.default, params: encodeParams(a.params) },
      this.programId,
    );
  }

  updateParams(admin: PublicKey, params: ProtocolParams) {
    return build("update_params", { admin, protocol: this.protocol }, { params: encodeParams(params) }, this.programId);
  }

  setPaused(admin: PublicKey, paused: boolean) {
    return build("set_paused", { admin, protocol: this.protocol }, { paused }, this.programId);
  }

  /** `PublicKey.default` disables co-signing. */
  setGatekeeper(admin: PublicKey, gatekeeper: PublicKey) {
    return build("set_gatekeeper", { admin, protocol: this.protocol }, { gatekeeper }, this.programId);
  }

  proposeAdmin(admin: PublicKey, newAdmin: PublicKey) {
    return build("propose_admin", { admin, protocol: this.protocol }, { new_admin: newAdmin }, this.programId);
  }

  acceptAdmin(newAdmin: PublicKey) {
    return build("accept_admin", { new_admin: newAdmin, protocol: this.protocol }, {}, this.programId);
  }

  fundReserve(a: { funder: PublicKey; tunnelMint: PublicKey; funderTokenAccount: PublicKey; amount: bigint }) {
    return build(
      "fund_reserve",
      {
        funder: a.funder,
        protocol: this.protocol,
        tunnel_mint: a.tunnelMint,
        reward_vault: rewardVaultPda(this.programId),
        funder_token_account: a.funderTokenAccount,
        token_program: TOKEN_PROGRAM_ID,
      },
      { amount: bn(a.amount) },
      this.programId,
    );
  }

  // ---- cycles ----

  openCycle(payer: PublicKey, nextCycleId: bigint) {
    return build(
      "open_cycle",
      { payer, protocol: this.protocol, cycle: cyclePda(nextCycleId, this.programId), system_program: SystemProgram.programId },
      {},
      this.programId,
    );
  }

  closeCycle(cycleId: bigint) {
    return build(
      "close_cycle",
      { protocol: this.protocol, cycle: cyclePda(cycleId, this.programId), slot_hashes: SYSVAR_SLOT_HASHES_PUBKEY },
      { cycle_id: bn(cycleId) },
      this.programId,
    );
  }

  /** `vrfTreasury` comes from ORAO's network state (`fetchOraoTreasury`). */
  requestRandomness(a: { cranker: PublicKey; cycleId: bigint; vrfSeed: Uint8Array; vrfTreasury: PublicKey }) {
    return build(
      "request_randomness",
      {
        cranker: a.cranker,
        cycle: cyclePda(a.cycleId, this.programId),
        vrf_request: oraoRandomnessPda(a.vrfSeed),
        vrf_config: oraoNetworkStatePda(),
        vrf_treasury: a.vrfTreasury,
        vrf_program: ORAO_VRF_PROGRAM_ID,
        system_program: SystemProgram.programId,
      },
      { cycle_id: bn(a.cycleId) },
      this.programId,
    );
  }

  revealRandomness(cycleId: bigint, vrfSeed: Uint8Array) {
    return build(
      "reveal_randomness",
      { cycle: cyclePda(cycleId, this.programId), vrf_request: oraoRandomnessPda(vrfSeed) },
      { cycle_id: bn(cycleId) },
      this.programId,
    );
  }

  settlePosition(cycleId: bigint, owner: PublicKey) {
    return build(
      "settle_position",
      { cycle: cyclePda(cycleId, this.programId), position: positionPda(cycleId, owner, this.programId) },
      { cycle_id: bn(cycleId) },
      this.programId,
    );
  }

  finalizeCycle(cycleId: bigint) {
    return build(
      "finalize_cycle",
      { protocol: this.protocol, cycle: cyclePda(cycleId, this.programId) },
      { cycle_id: bn(cycleId) },
      this.programId,
    );
  }

  /** `vrfSeed` is the cycle's seed (all zeros if the cycle never closed). */
  voidCycle(cycleId: bigint, vrfSeed: Uint8Array) {
    return build(
      "void_cycle",
      { protocol: this.protocol, cycle: cyclePda(cycleId, this.programId), vrf_request: oraoRandomnessPda(vrfSeed) },
      { cycle_id: bn(cycleId) },
      this.programId,
    );
  }

  sweepCycle(cycleId: bigint) {
    return build(
      "sweep_cycle",
      { protocol: this.protocol, cycle: cyclePda(cycleId, this.programId) },
      { cycle_id: bn(cycleId) },
      this.programId,
    );
  }

  // ---- users ----

  deployParticles(a: { owner: PublicKey; cycleId: bigint; barrier: number; level: number; count: number; gatekeeper?: PublicKey | null }) {
    return build(
      "deploy_particles",
      {
        owner: a.owner,
        protocol: this.protocol,
        cycle: cyclePda(a.cycleId, this.programId),
        position: positionPda(a.cycleId, a.owner, this.programId),
        gatekeeper: a.gatekeeper ?? null,
        system_program: SystemProgram.programId,
      },
      { cycle_id: bn(a.cycleId), barrier: a.barrier, level: a.level, count: a.count },
      this.programId,
    );
  }

  /**
   * Claims a position. When a non-zero payout is expected, the owner's
   * $TUNNEL token account is created idempotently first (the user pays its
   * rent once); a zero payout just closes the position and returns its rent.
   */
  claim(a: { owner: PublicKey; cycleId: bigint; tunnelMint: PublicKey; expectsTokens: boolean }): TransactionInstruction[] {
    const ata = getAssociatedTokenAddressSync(a.tunnelMint, a.owner);
    const ix = build(
      "claim",
      {
        owner: a.owner,
        protocol: this.protocol,
        cycle: cyclePda(a.cycleId, this.programId),
        position: positionPda(a.cycleId, a.owner, this.programId),
        tunnel_mint: a.tunnelMint,
        reward_vault: rewardVaultPda(this.programId),
        owner_token_account: a.expectsTokens ? ata : null,
        token_program: TOKEN_PROGRAM_ID,
      },
      { cycle_id: bn(a.cycleId) },
      this.programId,
    );
    return a.expectsTokens ? [createAssociatedTokenAccountIdempotentInstruction(a.owner, ata, a.owner, a.tunnelMint), ix] : [ix];
  }
}

/** ORAO's fee treasury, read from its network-state account (offset 8 + 32: config.authority, then treasury). */
export async function fetchOraoTreasury(connection: Connection): Promise<PublicKey> {
  const info = await connection.getAccountInfo(oraoNetworkStatePda());
  if (!info) throw new Error("ORAO VRF network state not found on this cluster");
  return new PublicKey(info.data.subarray(8 + 32, 8 + 64));
}

/**
 * Reads an ORAO VRF v2 randomness account for a seed.
 * Layout: 8-byte discriminator | u8 tag (0 Pending, 1 Fulfilled) | client (32) | seed (32) | randomness (64, fulfilled only).
 */
export async function fetchOraoRandomness(
  connection: Connection,
  seed: Uint8Array,
): Promise<{ exists: boolean; fulfilled: boolean; randomness: Uint8Array | null }> {
  const info = await connection.getAccountInfo(oraoRandomnessPda(seed));
  if (!info || !info.owner.equals(ORAO_VRF_PROGRAM_ID)) return { exists: false, fulfilled: false, randomness: null };
  const d = info.data;
  const fulfilled = d.length >= 8 + 1 + 64 + 64 && d[8] === 1 && Buffer.from(d.subarray(8 + 1 + 32, 8 + 1 + 64)).equals(Buffer.from(seed));
  return { exists: true, fulfilled, randomness: fulfilled ? Uint8Array.from(d.subarray(8 + 1 + 64, 8 + 1 + 128)) : null };
}
