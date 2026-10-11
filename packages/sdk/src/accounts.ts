import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import { PublicKey, type Connection } from "@solana/web3.js";
import idlJson from "./idl/tunnel.json";
import type { BarrierConfig, EnergyLevel, OddsTable, ProtocolParams } from "./constants";
import type { Outcome } from "./math";
import { cyclePda, positionPda, protocolPda } from "./pda";

export const IDL = idlJson as unknown as Idl;
export const coder = new BorshCoder(IDL);

export type CycleStatus = "open" | "closed" | "awaitingRandomness" | "resolving" | "settled" | "void";

export interface ProtocolAccount {
  address: PublicKey;
  admin: PublicKey;
  pendingAdmin: PublicKey | null;
  /** `PublicKey.default` when deployments need no co-signature. */
  gatekeeper: PublicKey;
  tunnelMint: PublicKey;
  rewardVault: PublicKey;
  params: ProtocolParams;
  odds: OddsTable;
  paused: boolean;
  nextCycleId: bigint;
  lastCycleOpenTs: number;
  lastCycleCloseTs: number;
  reserveAvailable: bigint;
  reserveFundedTotal: bigint;
  totalExperiments: bigint;
  totalParticles: bigint;
  totalEnergy: bigint;
  totalSuccesses: bigint;
  totalTokensAllocated: bigint;
  totalTokensClaimed: bigint;
  cyclesSettled: bigint;
}

export interface CycleAccount {
  address: PublicKey;
  id: bigint;
  status: CycleStatus;
  outcome: Outcome;
  openTs: number;
  closeTs: number;
  closedTs: number;
  barriers: BarrierConfig[];
  levels: EnergyLevel[];
  odds: OddsTable;
  energyPerCycle: number;
  randomnessTimeoutSecs: number;
  emissionBudget: bigint;
  participants: number;
  experiments: number;
  particles: bigint[];
  energyUsed: bigint;
  vrfSeed: Uint8Array;
  randomnessRequestedTs: number;
  randomness: Uint8Array;
  positionsSettled: number;
  successes: bigint[];
  totalNominal: bigint;
  tokensAllocated: bigint;
  settledTs: number;
  claims: number;
  tokensClaimed: bigint;
  swept: boolean;
}

export interface PositionAccount {
  address: PublicKey;
  owner: PublicKey;
  cycleId: bigint;
  /** [barrier][level] */
  particles: number[][];
  energyUsed: number;
  experiments: number;
  settled: boolean;
  successes: number[][];
  nominalReward: bigint;
  claimed: boolean;
  tokensPaid: bigint;
}

// Anchor decodes u64/i64 as BN and enums as `{ variantName: {} }`.
type Raw = Record<string, any>;
const big = (v: any): bigint => BigInt(v.toString());
const num = (v: any): number => Number(v.toString());
const variant = (v: Raw): string => Object.keys(v)[0];

/** BorshCoder keeps IDL (snake_case) names; normalise access either way. */
const g = (r: Raw, snake: string) => r[snake] ?? r[snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];

const barriers = (v: Raw[]): BarrierConfig[] =>
  v.map((b) => ({ heightMilli: num(g(b, "height_milli")), widthMilli: num(g(b, "width_milli")), rewardPremiumBps: num(g(b, "reward_premium_bps")) }));
const levels = (v: Raw[]): EnergyLevel[] => v.map((l) => ({ energyBps: num(g(l, "energy_bps")), cost: num(g(l, "cost")) }));
const odds = (o: Raw): OddsTable => ({
  transmissionPpb: g(o, "transmission_ppb").map((row: any[]) => row.map(num)),
  reward: g(o, "reward").map((row: any[]) => row.map(big)),
});

function params(p: Raw): ProtocolParams {
  return {
    barriers: barriers(g(p, "barriers")) as ProtocolParams["barriers"],
    levels: levels(g(p, "levels")),
    energyPerCycle: num(g(p, "energy_per_cycle")),
    rewardPerEnergy: big(g(p, "reward_per_energy")),
    cycleDurationSecs: num(g(p, "cycle_duration_secs")),
    randomnessTimeoutSecs: num(g(p, "randomness_timeout_secs")),
    initialEmissionPerCycle: big(g(p, "initial_emission_per_cycle")),
    emissionDecayBps: num(g(p, "emission_decay_bps")),
    emissionEpochCycles: num(g(p, "emission_epoch_cycles")),
  };
}

const statusMap: Record<string, CycleStatus> = {
  open: "open",
  closed: "closed",
  awaitingrandomness: "awaitingRandomness",
  resolving: "resolving",
  settled: "settled",
  void: "void",
};
const outcomeMap: Record<string, Outcome> = {
  pending: "pending",
  rewards: "rewards",
  notunnels: "noTunnels",
  void: "void",
  empty: "empty",
};

export function decodeProtocol(address: PublicKey, data: Buffer): ProtocolAccount {
  const r: Raw = coder.accounts.decode("Protocol", data);
  return {
    address,
    admin: g(r, "admin"),
    pendingAdmin: g(r, "pending_admin") ?? null,
    gatekeeper: g(r, "gatekeeper"),
    tunnelMint: g(r, "tunnel_mint"),
    rewardVault: g(r, "reward_vault"),
    params: params(g(r, "params")),
    odds: odds(g(r, "odds")),
    paused: g(r, "paused"),
    nextCycleId: big(g(r, "next_cycle_id")),
    lastCycleOpenTs: num(g(r, "last_cycle_open_ts")),
    lastCycleCloseTs: num(g(r, "last_cycle_close_ts")),
    reserveAvailable: big(g(r, "reserve_available")),
    reserveFundedTotal: big(g(r, "reserve_funded_total")),
    totalExperiments: big(g(r, "total_experiments")),
    totalParticles: big(g(r, "total_particles")),
    totalEnergy: big(g(r, "total_energy")),
    totalSuccesses: big(g(r, "total_successes")),
    totalTokensAllocated: big(g(r, "total_tokens_allocated")),
    totalTokensClaimed: big(g(r, "total_tokens_claimed")),
    cyclesSettled: big(g(r, "cycles_settled")),
  };
}

export function decodeCycle(address: PublicKey, data: Buffer): CycleAccount {
  const r: Raw = coder.accounts.decode("Cycle", data);
  return {
    address,
    id: big(g(r, "id")),
    status: statusMap[variant(g(r, "status")).toLowerCase()],
    outcome: outcomeMap[variant(g(r, "outcome")).toLowerCase()],
    openTs: num(g(r, "open_ts")),
    closeTs: num(g(r, "close_ts")),
    closedTs: num(g(r, "closed_ts")),
    barriers: barriers(g(r, "barriers")),
    levels: levels(g(r, "levels")),
    odds: odds(g(r, "odds")),
    energyPerCycle: num(g(r, "energy_per_cycle")),
    randomnessTimeoutSecs: num(g(r, "randomness_timeout_secs")),
    emissionBudget: big(g(r, "emission_budget")),
    participants: num(g(r, "participants")),
    experiments: num(g(r, "experiments")),
    particles: g(r, "particles").map(big),
    energyUsed: big(g(r, "energy_used")),
    vrfSeed: Uint8Array.from(g(r, "vrf_seed")),
    randomnessRequestedTs: num(g(r, "randomness_requested_ts")),
    randomness: Uint8Array.from(g(r, "randomness")),
    positionsSettled: num(g(r, "positions_settled")),
    successes: g(r, "successes").map(big),
    totalNominal: big(g(r, "total_nominal")),
    tokensAllocated: big(g(r, "tokens_allocated")),
    settledTs: num(g(r, "settled_ts")),
    claims: num(g(r, "claims")),
    tokensClaimed: big(g(r, "tokens_claimed")),
    swept: g(r, "swept"),
  };
}

export function decodePosition(address: PublicKey, data: Buffer): PositionAccount {
  const r: Raw = coder.accounts.decode("Position", data);
  return {
    address,
    owner: g(r, "owner"),
    cycleId: big(g(r, "cycle_id")),
    particles: g(r, "particles").map((row: any[]) => row.map(num)),
    energyUsed: num(g(r, "energy_used")),
    experiments: num(g(r, "experiments")),
    settled: g(r, "settled"),
    successes: g(r, "successes").map((row: any[]) => row.map(num)),
    nominalReward: big(g(r, "nominal_reward")),
    claimed: g(r, "claimed"),
    tokensPaid: big(g(r, "tokens_paid")),
  };
}

export const ACCOUNT_DISCRIMINATORS = Object.fromEntries(
  (IDL.accounts ?? []).map((a) => [a.name, Uint8Array.from(a.discriminator)]),
) as Record<"Protocol" | "Cycle" | "Position", Uint8Array>;

// ---------------------------------------------------------------- fetchers

export async function fetchProtocol(connection: Connection, programId?: PublicKey) {
  const address = protocolPda(programId);
  const info = await connection.getAccountInfo(address);
  return info ? decodeProtocol(address, info.data) : null;
}

export async function fetchCycle(connection: Connection, cycleId: bigint, programId?: PublicKey) {
  const address = cyclePda(cycleId, programId);
  const info = await connection.getAccountInfo(address);
  return info ? decodeCycle(address, info.data) : null;
}

export async function fetchCycles(connection: Connection, cycleIds: bigint[], programId?: PublicKey) {
  const addresses = cycleIds.map((id) => cyclePda(id, programId));
  const out: (CycleAccount | null)[] = [];
  for (let i = 0; i < addresses.length; i += 100) {
    const batch = addresses.slice(i, i + 100);
    const infos = await connection.getMultipleAccountsInfo(batch);
    infos.forEach((info, j) => out.push(info ? decodeCycle(batch[j], info.data) : null));
  }
  return out;
}

export async function fetchPosition(connection: Connection, cycleId: bigint, owner: PublicKey, programId?: PublicKey) {
  const address = positionPda(cycleId, owner, programId);
  const info = await connection.getAccountInfo(address);
  return info ? decodePosition(address, info.data) : null;
}

/** Every open position of a cycle (for settlement cranks). Filters by discriminator + cycle id. */
export async function fetchCyclePositions(connection: Connection, cycleId: bigint, programId: PublicKey) {
  const cycleIdLe = Buffer.alloc(8);
  cycleIdLe.writeBigUInt64LE(cycleId);
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      { memcmp: { offset: 0, bytes: encodeBase58(ACCOUNT_DISCRIMINATORS.Position) } },
      { memcmp: { offset: 8 + 32, bytes: encodeBase58(cycleIdLe) } },
    ],
  });
  return accounts.map((a) => decodePosition(a.pubkey, a.account.data));
}

/** Every open position owned by a wallet across all cycles. */
export async function fetchOwnerPositions(connection: Connection, owner: PublicKey, programId: PublicKey) {
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      { memcmp: { offset: 0, bytes: encodeBase58(ACCOUNT_DISCRIMINATORS.Position) } },
      { memcmp: { offset: 8, bytes: owner.toBase58() } },
    ],
  });
  return accounts.map((a) => decodePosition(a.pubkey, a.account.data));
}

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

export const isGatekeeperEnabled = (p: Pick<ProtocolAccount, "gatekeeper">) => !p.gatekeeper.equals(PublicKey.default);
