import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import { PublicKey, type Connection } from "@solana/web3.js";
import idlJson from "./idl/tunnel.json";
import type { BarrierParams, ProtocolParams } from "./constants";
import type { Outcome } from "./math";
import { positionPda, protocolPda, roundPda } from "./pda";

export const IDL = idlJson as unknown as Idl;
export const coder = new BorshCoder(IDL);

export type RoundStatus = "open" | "closed" | "awaitingRandomness" | "resolving" | "settled" | "failed";

export interface ProtocolAccount {
  address: PublicKey;
  admin: PublicKey;
  pendingAdmin: PublicKey | null;
  treasury: PublicKey;
  tunnelMint: PublicKey;
  rewardVault: PublicKey;
  params: ProtocolParams;
  paused: boolean;
  nextRoundId: bigint;
  lastRoundOpenTs: number;
  lastRoundCloseTs: number;
  reserveAvailable: bigint;
  reserveFundedTotal: bigint;
  totalLamportsCommitted: bigint;
  totalParticles: bigint;
  totalSuccesses: bigint;
  totalTokensAllocated: bigint;
  totalFeesLamports: bigint;
  roundsSettled: bigint;
}

export interface RoundAccount {
  address: PublicKey;
  id: bigint;
  status: RoundStatus;
  outcome: Outcome;
  openTs: number;
  closeTs: number;
  closedTs: number;
  barriers: BarrierParams[];
  particleCostLamports: bigint;
  protocolFeeBps: number;
  maxParticlesPerPosition: number;
  randomnessTimeoutSecs: number;
  emissionBudget: bigint;
  particles: bigint[];
  totalLamports: bigint;
  participants: number;
  vrfSeed: Uint8Array;
  randomnessRequestedTs: number;
  randomness: Uint8Array;
  positionsSettled: number;
  successes: bigint[];
  totalSuccessWeight: bigint;
  feeLamports: bigint;
  distributableLamports: bigint;
  settledTs: number;
  claims: number;
  lamportsClaimed: bigint;
  tokensClaimed: bigint;
  swept: boolean;
}

export interface PositionAccount {
  address: PublicKey;
  owner: PublicKey;
  roundId: bigint;
  particles: number[];
  lamports: bigint;
  settled: boolean;
  successes: number[];
  successWeight: bigint;
  claimed: boolean;
  lamportsPaid: bigint;
  tokensPaid: bigint;
}

// Anchor decodes u64/i64 as BN and enums as `{ variantName: {} }`.
type Raw = Record<string, any>;
const big = (v: any): bigint => BigInt(v.toString());
const num = (v: any): number => Number(v.toString());
const variant = (v: Raw): string => Object.keys(v)[0];

function params(p: Raw): ProtocolParams {
  return {
    barriers: p.barriers.map((b: Raw) => ({ transmissionBps: b.transmission_bps ?? b.transmissionBps, rewardWeight: b.reward_weight ?? b.rewardWeight })),
    particleCostLamports: big(p.particle_cost_lamports ?? p.particleCostLamports),
    roundDurationSecs: num(p.round_duration_secs ?? p.roundDurationSecs),
    protocolFeeBps: num(p.protocol_fee_bps ?? p.protocolFeeBps),
    maxParticlesPerPosition: num(p.max_particles_per_position ?? p.maxParticlesPerPosition),
    randomnessTimeoutSecs: num(p.randomness_timeout_secs ?? p.randomnessTimeoutSecs),
    initialEmissionPerRound: big(p.initial_emission_per_round ?? p.initialEmissionPerRound),
    emissionDecayBps: num(p.emission_decay_bps ?? p.emissionDecayBps),
    emissionEpochRounds: num(p.emission_epoch_rounds ?? p.emissionEpochRounds),
  } as ProtocolParams;
}

/** BorshCoder keeps IDL (snake_case) names; normalise access either way. */
const g = (r: Raw, snake: string) => r[snake] ?? r[snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];

const statusMap: Record<string, RoundStatus> = {
  Open: "open", open: "open",
  Closed: "closed", closed: "closed",
  AwaitingRandomness: "awaitingRandomness", awaitingRandomness: "awaitingRandomness",
  Resolving: "resolving", resolving: "resolving",
  Settled: "settled", settled: "settled",
  Failed: "failed", failed: "failed",
};
const outcomeMap: Record<string, Outcome> = {
  Pending: "pending", pending: "pending",
  Rewards: "rewards", rewards: "rewards",
  NoSuccessRefund: "noSuccessRefund", noSuccessRefund: "noSuccessRefund",
  FullRefund: "fullRefund", fullRefund: "fullRefund",
  Empty: "empty", empty: "empty",
};

export function decodeProtocol(address: PublicKey, data: Buffer): ProtocolAccount {
  const r: Raw = coder.accounts.decode("Protocol", data);
  return {
    address,
    admin: g(r, "admin"),
    pendingAdmin: g(r, "pending_admin") ?? null,
    treasury: g(r, "treasury"),
    tunnelMint: g(r, "tunnel_mint"),
    rewardVault: g(r, "reward_vault"),
    params: params(g(r, "params")),
    paused: g(r, "paused"),
    nextRoundId: big(g(r, "next_round_id")),
    lastRoundOpenTs: num(g(r, "last_round_open_ts")),
    lastRoundCloseTs: num(g(r, "last_round_close_ts")),
    reserveAvailable: big(g(r, "reserve_available")),
    reserveFundedTotal: big(g(r, "reserve_funded_total")),
    totalLamportsCommitted: big(g(r, "total_lamports_committed")),
    totalParticles: big(g(r, "total_particles")),
    totalSuccesses: big(g(r, "total_successes")),
    totalTokensAllocated: big(g(r, "total_tokens_allocated")),
    totalFeesLamports: big(g(r, "total_fees_lamports")),
    roundsSettled: big(g(r, "rounds_settled")),
  };
}

export function decodeRound(address: PublicKey, data: Buffer): RoundAccount {
  const r: Raw = coder.accounts.decode("Round", data);
  return {
    address,
    id: big(g(r, "id")),
    status: statusMap[variant(g(r, "status"))],
    outcome: outcomeMap[variant(g(r, "outcome"))],
    openTs: num(g(r, "open_ts")),
    closeTs: num(g(r, "close_ts")),
    closedTs: num(g(r, "closed_ts")),
    barriers: g(r, "barriers").map((b: Raw) => ({ transmissionBps: g(b, "transmission_bps"), rewardWeight: g(b, "reward_weight") })),
    particleCostLamports: big(g(r, "particle_cost_lamports")),
    protocolFeeBps: num(g(r, "protocol_fee_bps")),
    maxParticlesPerPosition: num(g(r, "max_particles_per_position")),
    randomnessTimeoutSecs: num(g(r, "randomness_timeout_secs")),
    emissionBudget: big(g(r, "emission_budget")),
    particles: g(r, "particles").map(big),
    totalLamports: big(g(r, "total_lamports")),
    participants: num(g(r, "participants")),
    vrfSeed: Uint8Array.from(g(r, "vrf_seed")),
    randomnessRequestedTs: num(g(r, "randomness_requested_ts")),
    randomness: Uint8Array.from(g(r, "randomness")),
    positionsSettled: num(g(r, "positions_settled")),
    successes: g(r, "successes").map(big),
    totalSuccessWeight: big(g(r, "total_success_weight")),
    feeLamports: big(g(r, "fee_lamports")),
    distributableLamports: big(g(r, "distributable_lamports")),
    settledTs: num(g(r, "settled_ts")),
    claims: num(g(r, "claims")),
    lamportsClaimed: big(g(r, "lamports_claimed")),
    tokensClaimed: big(g(r, "tokens_claimed")),
    swept: g(r, "swept"),
  };
}

export function decodePosition(address: PublicKey, data: Buffer): PositionAccount {
  const r: Raw = coder.accounts.decode("Position", data);
  return {
    address,
    owner: g(r, "owner"),
    roundId: big(g(r, "round_id")),
    particles: g(r, "particles").map(num),
    lamports: big(g(r, "lamports")),
    settled: g(r, "settled"),
    successes: g(r, "successes").map(num),
    successWeight: big(g(r, "success_weight")),
    claimed: g(r, "claimed"),
    lamportsPaid: big(g(r, "lamports_paid")),
    tokensPaid: big(g(r, "tokens_paid")),
  };
}

export const ACCOUNT_DISCRIMINATORS = Object.fromEntries(
  (IDL.accounts ?? []).map((a) => [a.name, Uint8Array.from(a.discriminator)]),
) as Record<"Protocol" | "Round" | "RoundVault" | "Position", Uint8Array>;

// ---------------------------------------------------------------- fetchers

export async function fetchProtocol(connection: Connection, programId?: PublicKey) {
  const address = protocolPda(programId);
  const info = await connection.getAccountInfo(address);
  return info ? decodeProtocol(address, info.data) : null;
}

export async function fetchRound(connection: Connection, roundId: bigint, programId?: PublicKey) {
  const address = roundPda(roundId, programId);
  const info = await connection.getAccountInfo(address);
  return info ? decodeRound(address, info.data) : null;
}

export async function fetchRounds(connection: Connection, roundIds: bigint[], programId?: PublicKey) {
  const addresses = roundIds.map((id) => roundPda(id, programId));
  const out: (RoundAccount | null)[] = [];
  for (let i = 0; i < addresses.length; i += 100) {
    const batch = addresses.slice(i, i + 100);
    const infos = await connection.getMultipleAccountsInfo(batch);
    infos.forEach((info, j) => out.push(info ? decodeRound(batch[j], info.data) : null));
  }
  return out;
}

export async function fetchPosition(connection: Connection, roundId: bigint, owner: PublicKey, programId?: PublicKey) {
  const address = positionPda(roundId, owner, programId);
  const info = await connection.getAccountInfo(address);
  return info ? decodePosition(address, info.data) : null;
}

/** Every position of a round (for settlement cranks). Filters by discriminator + round id. */
export async function fetchRoundPositions(connection: Connection, roundId: bigint, programId: PublicKey) {
  const roundIdLe = Buffer.alloc(8);
  roundIdLe.writeBigUInt64LE(roundId);
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      { memcmp: { offset: 0, bytes: bs58(ACCOUNT_DISCRIMINATORS.Position) } },
      { memcmp: { offset: 8 + 32, bytes: bs58(roundIdLe) } },
    ],
  });
  return accounts.map((a) => decodePosition(a.pubkey, a.account.data));
}

/** Every position owned by a wallet across all rounds. */
export async function fetchOwnerPositions(connection: Connection, owner: PublicKey, programId: PublicKey) {
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      { memcmp: { offset: 0, bytes: bs58(ACCOUNT_DISCRIMINATORS.Position) } },
      { memcmp: { offset: 8, bytes: owner.toBase58() } },
    ],
  });
  return accounts.map((a) => decodePosition(a.pubkey, a.account.data));
}

const bs58 = (bytes: Uint8Array) => encodeBase58(bytes);

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function encodeBase58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}
