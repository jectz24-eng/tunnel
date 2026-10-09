/**
 * Instruction builders. Every TUNNEL instruction the app, keeper, scripts and
 * tests send is built here, with accounts ordered from the IDL.
 */
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { IDL, coder } from "./accounts";
import { ORAO_VRF_PROGRAM_ID, TUNNEL_PROGRAM_ID, type ProtocolParams } from "./constants";
import {
  oraoNetworkStatePda,
  oraoRandomnessPda,
  positionPda,
  protocolPda,
  rewardVaultPda,
  roundPda,
  treasuryVaultPda,
  roundVaultPda,
} from "./pda";

const BPF_UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

function build(
  name: string,
  accounts: Record<string, PublicKey>,
  args: Record<string, unknown>,
  programId: PublicKey,
): TransactionInstruction {
  const def = IDL.instructions.find((i) => i.name === name);
  if (!def) throw new Error(`unknown instruction ${name}`);
  const keys = def.accounts.map((a) => {
    const acc = a as { name: string; writable?: boolean; signer?: boolean };
    const pubkey = accounts[acc.name];
    if (!pubkey) throw new Error(`${name}: missing account ${acc.name}`);
    return { pubkey, isWritable: !!acc.writable, isSigner: !!acc.signer };
  });
  return new TransactionInstruction({ programId, keys, data: coder.instruction.encode(name, args) });
}

const bn = (v: bigint | number) => new BN(v.toString());

function encodeParams(p: ProtocolParams) {
  return {
    barriers: p.barriers.map((b) => ({ transmission_bps: b.transmissionBps, reward_weight: b.rewardWeight })),
    particle_cost_lamports: bn(p.particleCostLamports),
    round_duration_secs: p.roundDurationSecs,
    protocol_fee_bps: p.protocolFeeBps,
    max_particles_per_position: p.maxParticlesPerPosition,
    randomness_timeout_secs: p.randomnessTimeoutSecs,
    initial_emission_per_round: bn(p.initialEmissionPerRound),
    emission_decay_bps: p.emissionDecayBps,
    emission_epoch_rounds: p.emissionEpochRounds,
  };
}

export class TunnelInstructions {
  constructor(readonly programId: PublicKey = TUNNEL_PROGRAM_ID) {}

  private get protocol() {
    return protocolPda(this.programId);
  }

  // ---- administration ----

  initialize(a: { admin: PublicKey; tunnelMint: PublicKey; treasury: PublicKey; params: ProtocolParams }) {
    const [programData] = PublicKey.findProgramAddressSync([this.programId.toBytes()], BPF_UPGRADEABLE_LOADER);
    return build(
      "initialize",
      {
        admin: a.admin,
        protocol: this.protocol,
        tunnel_mint: a.tunnelMint,
        reward_vault: rewardVaultPda(this.programId),
        treasury_vault: treasuryVaultPda(this.programId),
        program: this.programId,
        program_data: programData,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
      },
      { treasury: a.treasury, params: encodeParams(a.params) },
      this.programId,
    );
  }

  updateParams(admin: PublicKey, params: ProtocolParams) {
    return build("update_params", { admin, protocol: this.protocol }, { params: encodeParams(params) }, this.programId);
  }

  setPaused(admin: PublicKey, paused: boolean) {
    return build("set_paused", { admin, protocol: this.protocol }, { paused }, this.programId);
  }

  setTreasury(admin: PublicKey, treasury: PublicKey) {
    return build("set_treasury", { admin, protocol: this.protocol }, { treasury }, this.programId);
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

  // ---- rounds ----

  openRound(payer: PublicKey, nextRoundId: bigint) {
    return build(
      "open_round",
      {
        payer,
        protocol: this.protocol,
        round: roundPda(nextRoundId, this.programId),
        round_vault: roundVaultPda(nextRoundId, this.programId),
        system_program: SystemProgram.programId,
      },
      {},
      this.programId,
    );
  }

  closeRound(roundId: bigint) {
    return build(
      "close_round",
      { protocol: this.protocol, round: roundPda(roundId, this.programId), slot_hashes: SYSVAR_SLOT_HASHES_PUBKEY },
      { round_id: bn(roundId) },
      this.programId,
    );
  }

  /** `vrfTreasury` comes from ORAO's network state (`fetchOraoTreasury`). */
  requestRandomness(a: { cranker: PublicKey; roundId: bigint; vrfSeed: Uint8Array; vrfTreasury: PublicKey }) {
    return build(
      "request_randomness",
      {
        cranker: a.cranker,
        round: roundPda(a.roundId, this.programId),
        vrf_request: oraoRandomnessPda(a.vrfSeed),
        vrf_config: oraoNetworkStatePda(),
        vrf_treasury: a.vrfTreasury,
        vrf_program: ORAO_VRF_PROGRAM_ID,
        system_program: SystemProgram.programId,
      },
      { round_id: bn(a.roundId) },
      this.programId,
    );
  }

  revealRandomness(roundId: bigint, vrfSeed: Uint8Array) {
    return build(
      "reveal_randomness",
      { round: roundPda(roundId, this.programId), vrf_request: oraoRandomnessPda(vrfSeed) },
      { round_id: bn(roundId) },
      this.programId,
    );
  }

  settlePosition(roundId: bigint, owner: PublicKey) {
    return build(
      "settle_position",
      { round: roundPda(roundId, this.programId), position: positionPda(roundId, owner, this.programId) },
      { round_id: bn(roundId) },
      this.programId,
    );
  }

  finalizeRound(roundId: bigint) {
    return build(
      "finalize_round",
      {
        protocol: this.protocol,
        round: roundPda(roundId, this.programId),
        round_vault: roundVaultPda(roundId, this.programId),
        treasury_vault: treasuryVaultPda(this.programId),
      },
      { round_id: bn(roundId) },
      this.programId,
    );
  }

  /** `vrfSeed` is the round's seed (all zeros if the round never closed). */
  recoverRound(roundId: bigint, vrfSeed: Uint8Array) {
    return build(
      "recover_round",
      { protocol: this.protocol, round: roundPda(roundId, this.programId), vrf_request: oraoRandomnessPda(vrfSeed) },
      { round_id: bn(roundId) },
      this.programId,
    );
  }

  sweepRound(roundId: bigint) {
    return build(
      "sweep_round",
      {
        protocol: this.protocol,
        round: roundPda(roundId, this.programId),
        round_vault: roundVaultPda(roundId, this.programId),
        treasury_vault: treasuryVaultPda(this.programId),
      },
      { round_id: bn(roundId) },
      this.programId,
    );
  }

  /** Permissionless; pays only the treasury recorded in the Protocol account. */
  withdrawFees(treasury: PublicKey) {
    return build(
      "withdraw_fees",
      { protocol: this.protocol, treasury_vault: treasuryVaultPda(this.programId), treasury },
      {},
      this.programId,
    );
  }

  // ---- users ----

  deployParticles(a: { owner: PublicKey; roundId: bigint; barrier: number; count: number }) {
    return build(
      "deploy_particles",
      {
        owner: a.owner,
        protocol: this.protocol,
        round: roundPda(a.roundId, this.programId),
        round_vault: roundVaultPda(a.roundId, this.programId),
        position: positionPda(a.roundId, a.owner, this.programId),
        system_program: SystemProgram.programId,
      },
      { round_id: bn(a.roundId), barrier: a.barrier, count: a.count },
      this.programId,
    );
  }

  claim(a: { owner: PublicKey; roundId: bigint; tunnelMint: PublicKey }) {
    return build(
      "claim",
      {
        owner: a.owner,
        protocol: this.protocol,
        round: roundPda(a.roundId, this.programId),
        round_vault: roundVaultPda(a.roundId, this.programId),
        position: positionPda(a.roundId, a.owner, this.programId),
        tunnel_mint: a.tunnelMint,
        reward_vault: rewardVaultPda(this.programId),
        owner_token_account: getAssociatedTokenAddressSync(a.tunnelMint, a.owner),
        token_program: TOKEN_PROGRAM_ID,
        associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
      },
      { round_id: bn(a.roundId) },
      this.programId,
    );
  }
}

/** ORAO's fee treasury, read from its network-state account (offset 8 + 32: config.authority, then treasury). */
export async function fetchOraoTreasury(connection: import("@solana/web3.js").Connection): Promise<PublicKey> {
  const info = await connection.getAccountInfo(oraoNetworkStatePda());
  if (!info) throw new Error("ORAO VRF network state not found on this cluster");
  // NetworkState { config: NetworkConfiguration { authority: Pubkey, treasury: Pubkey, ... }, ... }
  return new PublicKey(info.data.subarray(8 + 32, 8 + 64));
}

/**
 * Reads an ORAO VRF v2 randomness account for a seed.
 * Layout: 8-byte discriminator | u8 tag (0 Pending, 1 Fulfilled) | client (32) | seed (32) | randomness (64, fulfilled only).
 */
export async function fetchOraoRandomness(
  connection: import("@solana/web3.js").Connection,
  seed: Uint8Array,
): Promise<{ exists: boolean; fulfilled: boolean; randomness: Uint8Array | null }> {
  const info = await connection.getAccountInfo(oraoRandomnessPda(seed));
  if (!info || !info.owner.equals(ORAO_VRF_PROGRAM_ID)) return { exists: false, fulfilled: false, randomness: null };
  const d = info.data;
  const fulfilled = d.length >= 8 + 1 + 64 + 64 && d[8] === 1 && Buffer.from(d.subarray(8 + 1 + 32, 8 + 1 + 64)).equals(Buffer.from(seed));
  return { exists: true, fulfilled, randomness: fulfilled ? Uint8Array.from(d.subarray(8 + 1 + 64, 8 + 1 + 128)) : null };
}
