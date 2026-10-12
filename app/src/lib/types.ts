/**
 * Client-side shapes of server protocol data (parsed from /api JSON, where
 * bigints travel as decimal strings and times as ISO strings).
 */
import {
  fromHex,
  oddsFromJson,
  paramsFromJson,
  unflatten,
  type BarrierConfig,
  type EnergyLevel,
  type OddsTable,
  type OddsTableJson,
  type Outcome,
  type ProtocolParams,
  type ProtocolParamsJson,
} from "@tunnel/sdk";

export type CycleStatus = "open" | "closed" | "settled" | "void";
export type PayoutStatus = "requested" | "sending" | "confirmed" | "failed";

export interface CycleAccount {
  id: bigint;
  status: CycleStatus;
  outcome: Outcome;
  /** Unix seconds. */
  openTs: number;
  closeTs: number;
  closedTs: number | null;
  settledTs: number | null;
  barriers: BarrierConfig[];
  levels: EnergyLevel[];
  odds: OddsTable;
  energyPerCycle: number;
  emissionBudget: bigint;
  participants: number;
  experiments: number;
  /** Per barrier. */
  particles: bigint[];
  energyUsed: bigint;
  successes: bigint[];
  totalNominal: bigint;
  tokensAllocated: bigint;
  seedCommitment: string;
  /** Revealed only once the cycle is settled or void. */
  serverSeed: string | null;
  entropySlot: bigint;
  entropySlotUsed: bigint | null;
  entropyBlockhash: string | null;
  randomnessHex: string | null;
  randomness: Uint8Array | null;
}

export interface PositionAccount {
  owner: string;
  cycleId: bigint;
  /** [barrier][level] */
  particles: number[][];
  successes: number[][];
  energyUsed: number;
  experiments: number;
  settled: boolean;
  nominalReward: bigint;
  /** Final $TUNNEL owed; null until settlement. */
  payout: bigint | null;
  payoutStatus: PayoutStatus | null;
  payoutTx: string | null;
  claimed: boolean;
}

export interface ProtocolTotals {
  cycles: number;
  users: number;
  experiments: number;
  particles: bigint;
  successes: bigint;
  energyUsed: bigint;
  tokensAllocated: bigint;
  tokensClaimed: bigint;
}

export interface ProtocolAccount {
  params: ProtocolParams;
  odds: OddsTable;
  paused: boolean;
  tunnelMint: string | null;
  rewardWallet: string | null;
  reserveFundedTotal: bigint;
  reserveAvailable: bigint;
  rewardWalletTokens: bigint | null;
  rewardWalletLamports: bigint | null;
  lastSlot: bigint | null;
  engineOnline: boolean;
  totals: ProtocolTotals;
}

export interface Payout {
  id: bigint;
  amount: bigint;
  status: PayoutStatus;
  txSignature: string | null;
  createdAt: string;
  confirmedAt: string | null;
  error: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>;
const big = (v: any): bigint => BigInt(v ?? 0);
const bigOrNull = (v: any): bigint | null => (v == null ? null : BigInt(v));
const secs = (v: any): number => Math.floor(new Date(v).getTime() / 1000);
const secsOrNull = (v: any): number | null => (v == null ? null : secs(v));

export function parseCycle(c: Json): CycleAccount {
  return {
    id: big(c.id),
    status: c.status,
    outcome: c.outcome,
    openTs: secs(c.openTs),
    closeTs: secs(c.closeTs),
    closedTs: secsOrNull(c.closedAt),
    settledTs: secsOrNull(c.settledAt),
    barriers: c.barriers,
    levels: c.levels,
    odds: oddsFromJson(c.odds as OddsTableJson),
    energyPerCycle: c.energyPerCycle,
    emissionBudget: big(c.emissionBudget),
    participants: c.participants,
    experiments: c.experiments,
    particles: (c.particles as string[]).map(big),
    energyUsed: big(c.energyUsed),
    successes: (c.successes as string[]).map(big),
    totalNominal: big(c.totalNominal),
    tokensAllocated: big(c.tokensAllocated),
    seedCommitment: c.seedCommitment,
    serverSeed: c.serverSeed ?? null,
    entropySlot: big(c.entropySlot),
    entropySlotUsed: bigOrNull(c.entropySlotUsed),
    entropyBlockhash: c.entropyBlockhash ?? null,
    randomnessHex: c.randomness ?? null,
    randomness: c.randomness ? fromHex(c.randomness) : null,
  };
}

export function parsePosition(p: Json): PositionAccount {
  return {
    owner: p.owner ?? p.wallet,
    cycleId: big(p.cycleId),
    particles: unflatten(p.particles as number[]),
    successes: unflatten(p.successes as number[]),
    energyUsed: p.energyUsed,
    experiments: p.experiments,
    settled: p.settled,
    nominalReward: big(p.nominalReward),
    payout: bigOrNull(p.payout),
    payoutStatus: p.payoutStatus ?? null,
    payoutTx: p.payoutTx ?? null,
    claimed: p.payoutStatus === "confirmed",
  };
}

export function parseProtocol(cfg: Json, totals: Json): ProtocolAccount {
  return {
    params: paramsFromJson(cfg.params as ProtocolParamsJson),
    odds: oddsFromJson(cfg.odds as OddsTableJson),
    paused: cfg.paused,
    tunnelMint: cfg.tunnelMint ?? null,
    rewardWallet: cfg.rewardWallet ?? null,
    reserveFundedTotal: big(cfg.reserveFundedTotal),
    reserveAvailable: big(cfg.reserveAvailable),
    rewardWalletTokens: bigOrNull(cfg.rewardWalletTokens),
    rewardWalletLamports: bigOrNull(cfg.rewardWalletLamports),
    lastSlot: bigOrNull(cfg.lastSlot),
    engineOnline: !!cfg.engineOnline,
    totals: {
      cycles: totals.cycles,
      users: totals.users,
      experiments: totals.experiments,
      particles: big(totals.particles),
      successes: big(totals.successes),
      energyUsed: big(totals.energyUsed),
      tokensAllocated: big(totals.tokensAllocated),
      tokensClaimed: big(totals.tokensClaimed),
    },
  };
}

export function parsePayout(p: Json): Payout {
  return { ...p, id: big(p.id), amount: big(p.amount) } as Payout;
}
