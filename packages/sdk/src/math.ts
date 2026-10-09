/**
 * Exact TypeScript mirror of programs/tunnel/src/math.rs and the payout rules
 * in claim.rs. All settlement values are bigint; nothing here uses floats.
 * Anyone can use these functions to recompute a round's outcomes from the
 * onchain randomness and verify what the program paid.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { BPS, PARTICLE_DOMAIN, type ProtocolParams } from "./constants";
import { u64le } from "./pda";

const FIXED_ONE = 10n ** 18n;
const U64_MAX = (1n << 64n) - 1n;
const domain = new TextEncoder().encode(PARTICLE_DOMAIN);

export function successThreshold(transmissionBps: number): bigint {
  return ((BigInt(transmissionBps) << 64n) / BPS) & U64_MAX;
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

/** u64_le(sha256(DOMAIN ‖ randomness ‖ round_id_le ‖ owner ‖ barrier ‖ index_le)[0..8]) */
export function particleDraw(
  randomness: Uint8Array,
  roundId: bigint,
  owner: Uint8Array,
  barrier: number,
  index: number,
): bigint {
  if (randomness.length !== 64) throw new Error("randomness must be 64 bytes");
  if (owner.length !== 32) throw new Error("owner must be 32 bytes");
  const h = sha256
    .create()
    .update(domain)
    .update(randomness)
    .update(u64le(roundId))
    .update(owner)
    .update(Uint8Array.of(barrier))
    .update(u32le(index))
    .digest();
  return new DataView(h.buffer, h.byteOffset, 8).getBigUint64(0, true);
}

export interface ParticleOutcome {
  barrier: number;
  index: number;
  draw: bigint;
  success: boolean;
}

/** Every particle outcome for one barrier of one position, in index order. */
export function particleOutcomes(
  randomness: Uint8Array,
  roundId: bigint,
  owner: Uint8Array,
  barrier: number,
  count: number,
  transmissionBps: number,
): ParticleOutcome[] {
  const t = successThreshold(transmissionBps);
  const out: ParticleOutcome[] = [];
  for (let i = 0; i < count; i++) {
    const draw = particleDraw(randomness, roundId, owner, barrier, i);
    out.push({ barrier, index: i, draw, success: draw < t });
  }
  return out;
}

export function countSuccesses(
  randomness: Uint8Array,
  roundId: bigint,
  owner: Uint8Array,
  barrier: number,
  count: number,
  transmissionBps: number,
): number {
  return particleOutcomes(randomness, roundId, owner, barrier, count, transmissionBps).filter((o) => o.success)
    .length;
}

export function mulDiv(amount: bigint, num: bigint, den: bigint): bigint {
  if (den === 0n) throw new Error("division by zero");
  const v = (amount * num) / den;
  if (v > U64_MAX) throw new Error("u64 overflow");
  return v;
}

function fixedPow(base: bigint, exp: bigint): bigint {
  let result = FIXED_ONE;
  let b = base;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) / FIXED_ONE;
    e >>= 1n;
    if (e > 0n) b = (b * b) / FIXED_ONE;
    if (result === 0n) break;
  }
  return result;
}

export function scheduledEmission(params: Pick<ProtocolParams, "initialEmissionPerRound" | "emissionDecayBps" | "emissionEpochRounds">, roundId: bigint): bigint {
  const epoch = roundId / BigInt(Math.max(1, params.emissionEpochRounds));
  const decay = BigInt(params.emissionDecayBps) * (FIXED_ONE / BPS);
  return (params.initialEmissionPerRound * fixedPow(decay, epoch)) / FIXED_ONE;
}

export function splitFee(totalLamports: bigint, feeBps: number): { fee: bigint; distributable: bigint } {
  const fee = mulDiv(totalLamports, BigInt(feeBps), BPS);
  return { fee, distributable: totalLamports - fee };
}

export type Outcome = "pending" | "rewards" | "noSuccessRefund" | "fullRefund" | "empty";

export interface PayoutInput {
  outcome: Outcome;
  distributableLamports: bigint;
  totalLamports: bigint;
  totalSuccessWeight: bigint;
  emissionBudget: bigint;
  positionLamports: bigint;
  positionSuccessWeight: bigint;
}

/** Mirrors `compute_payout` in claim.rs. Returns null when nothing is claimable yet. */
export function computePayout(p: PayoutInput): { lamports: bigint; tokens: bigint } | null {
  switch (p.outcome) {
    case "rewards":
      return {
        lamports: mulDiv(p.distributableLamports, p.positionSuccessWeight, p.totalSuccessWeight),
        tokens: mulDiv(p.emissionBudget, p.positionSuccessWeight, p.totalSuccessWeight),
      };
    case "noSuccessRefund":
      return { lamports: mulDiv(p.distributableLamports, p.positionLamports, p.totalLamports), tokens: 0n };
    case "fullRefund":
      return { lamports: p.positionLamports, tokens: 0n };
    default:
      return null;
  }
}

/** Projected cumulative emission for charts (pre-cap). Sampled per epoch. */
export function emissionCurve(
  params: Pick<ProtocolParams, "initialEmissionPerRound" | "emissionDecayBps" | "emissionEpochRounds">,
  epochs: number,
  stride = 1,
): { epoch: number; perRound: bigint; cumulative: bigint }[] {
  const out: { epoch: number; perRound: bigint; cumulative: bigint }[] = [];
  let cumulative = 0n;
  const rounds = BigInt(params.emissionEpochRounds);
  for (let e = 0; e < epochs; e++) {
    const perRound = scheduledEmission(params, BigInt(e) * rounds);
    cumulative += perRound * rounds;
    if (e % stride === 0) out.push({ epoch: e, perRound, cumulative });
  }
  return out;
}
