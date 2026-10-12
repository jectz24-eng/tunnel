/**
 * Exact TypeScript mirror of programs/tunnel/src/math.rs. Every settlement
 * value is bigint; the only floating point is the physics model that derives
 * the odds table (mirrored separately in physics.ts). Anyone can use these
 * functions to recompute a cycle's outcomes from the onchain randomness and
 * verify what the program paid.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { BPS, PARTICLE_DOMAIN, type OddsTable, type ProtocolParams } from "./constants";
import { u64le } from "./bytes";
import { PPB, transmissionPpb } from "./physics";

const FIXED_ONE = 10n ** 18n;
const U64_MAX = (1n << 64n) - 1n;
const domain = new TextEncoder().encode(PARTICLE_DOMAIN);

export function successThreshold(transmissionPpb: number): bigint {
  return ((BigInt(transmissionPpb) << 64n) / BigInt(PPB)) & U64_MAX;
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

/** u64_le(sha256(DOMAIN ‖ randomness ‖ cycle_id_le ‖ owner ‖ barrier ‖ level ‖ index_le)[0..8]) */
export function particleDraw(
  randomness: Uint8Array,
  cycleId: bigint,
  owner: Uint8Array,
  barrier: number,
  level: number,
  index: number,
): bigint {
  if (randomness.length !== 64) throw new Error("randomness must be 64 bytes");
  if (owner.length !== 32) throw new Error("owner must be 32 bytes");
  const h = sha256
    .create()
    .update(domain)
    .update(randomness)
    .update(u64le(cycleId))
    .update(owner)
    .update(Uint8Array.of(barrier, level))
    .update(u32le(index))
    .digest();
  return new DataView(h.buffer, h.byteOffset, 8).getBigUint64(0, true);
}

export interface ParticleOutcome {
  barrier: number;
  level: number;
  index: number;
  draw: bigint;
  success: boolean;
}

/** Outcomes of particles `firstIndex .. firstIndex+count` in one [barrier][level] cell. */
export function particleOutcomes(
  randomness: Uint8Array,
  cycleId: bigint,
  owner: Uint8Array,
  barrier: number,
  level: number,
  count: number,
  transmissionPpb: number,
  firstIndex = 0,
): ParticleOutcome[] {
  const t = successThreshold(transmissionPpb);
  const out: ParticleOutcome[] = [];
  for (let i = firstIndex; i < firstIndex + count; i++) {
    const draw = particleDraw(randomness, cycleId, owner, barrier, level, i);
    out.push({ barrier, level, index: i, draw, success: draw < t });
  }
  return out;
}

export function mulDiv(amount: bigint, num: bigint, den: bigint): bigint {
  if (den === 0n) throw new Error("division by zero");
  const v = (amount * num) / den;
  if (v > U64_MAX) throw new Error("u64 overflow");
  return v;
}

/** `floor(rewardPerEnergy · cost · premiumBps · 10⁹ / (10⁴ · ppb))` */
export function nominalReward(rewardPerEnergy: bigint, cost: number, premiumBps: number, ppb: number): bigint {
  const v = (rewardPerEnergy * BigInt(cost) * BigInt(premiumBps) * BigInt(PPB)) / (BPS * BigInt(ppb));
  if (v > U64_MAX) throw new Error("u64 overflow");
  return v;
}

/** Mirrors `derive_odds`: physics → probabilities → calibrated rewards. Throws on out-of-bounds physics. */
export function deriveOdds(params: Pick<ProtocolParams, "barriers" | "levels" | "rewardPerEnergy">): OddsTable {
  const transmission: number[][] = [];
  const reward: bigint[][] = [];
  params.barriers.forEach((b, bi) => {
    transmission.push([]);
    reward.push([]);
    params.levels.forEach((l) => {
      const ppb = transmissionPpb(b.heightMilli, b.widthMilli, l.energyBps);
      if (ppb == null) throw new Error(`barrier ${bi} at ${l.energyBps} bps is outside the probability bounds`);
      transmission[bi].push(ppb);
      reward[bi].push(nominalReward(params.rewardPerEnergy, l.cost, b.rewardPremiumBps, ppb));
    });
  });
  return { transmissionPpb: transmission, reward };
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

type EmissionParams = Pick<ProtocolParams, "initialEmissionPerCycle" | "emissionDecayBps" | "emissionEpochCycles">;

export function scheduledEmission(params: EmissionParams, cycleId: bigint): bigint {
  const epoch = cycleId / BigInt(Math.max(1, params.emissionEpochCycles));
  const decay = BigInt(params.emissionDecayBps) * (FIXED_ONE / BPS);
  return (params.initialEmissionPerCycle * fixedPow(decay, epoch)) / FIXED_ONE;
}

export type Outcome = "pending" | "rewards" | "noTunnels" | "void" | "empty";

/** Mirrors `compute_payout`: nominal in full while the cycle is within budget, else pro rata. */
export function computePayout(p: { outcome: Outcome; totalNominal: bigint; emissionBudget: bigint; positionNominal: bigint }): bigint {
  if (p.outcome !== "rewards" || p.positionNominal === 0n) return 0n;
  if (p.totalNominal <= p.emissionBudget) return p.positionNominal;
  return mulDiv(p.emissionBudget, p.positionNominal, p.totalNominal);
}

/** Projected cumulative emission for charts (pre-cap). Sampled per epoch. */
export function emissionCurve(params: EmissionParams, epochs: number, stride = 1) {
  const out: { epoch: number; perCycle: bigint; cumulative: bigint }[] = [];
  let cumulative = 0n;
  const cycles = BigInt(params.emissionEpochCycles);
  for (let e = 0; e < epochs; e++) {
    const perCycle = scheduledEmission(params, BigInt(e) * cycles);
    cumulative += perCycle * cycles;
    if (e % stride === 0) out.push({ epoch: e, perCycle, cumulative });
  }
  return out;
}

/** Expected nominal reward of `count` particles in a cell (probability × reward). */
export function expectedReward(odds: OddsTable, barrier: number, level: number, count: number): bigint {
  return (odds.reward[barrier][level] * BigInt(odds.transmissionPpb[barrier][level]) * BigInt(count)) / BigInt(PPB);
}

/** Probability that at least one of `count` independent particles tunnels. */
export function atLeastOneProbability(ppb: number, count: number): number {
  return 1 - Math.pow(1 - ppb / PPB, count);
}
