/**
 * Independent verification of a settled cycle from public data only: the
 * cycle's revealed seed, the Solana blockhash it committed to, its odds
 * snapshot, and every wallet's particles. Recomputes the randomness, every
 * particle outcome, every payout, and the odds table itself from the physics.
 */
import { decodeBase58, fromHex } from "./bytes";
import { BARRIER_COUNT, ENERGY_LEVELS, type BarrierConfig, type EnergyLevel, type OddsTable } from "./constants";
import { verifyCycleFairness } from "./fairness";
import { computePayout, particleOutcomes, type Outcome } from "./math";
import { transmissionPpb } from "./physics";

export interface PublishedCycle {
  id: bigint;
  barriers: BarrierConfig[];
  levels: EnergyLevel[];
  odds: OddsTable;
  emissionBudget: bigint;
  totalNominal: bigint;
  outcome: Outcome;
  seedCommitment: string;
  serverSeed: string | null;
  entropyBlockhash: string | null;
  randomness: string | null;
}

export interface PublishedPosition {
  wallet: string;
  /** [barrier][level] */
  particles: number[][];
  successes: number[][];
  nominalReward: bigint;
  payout: bigint | null;
}

export interface CycleVerification {
  oddsMatchPhysics: boolean;
  commitmentMatches: boolean | null;
  randomnessMatches: boolean | null;
  positions: { wallet: string; matches: boolean; expectedSuccesses: number[][]; expectedNominal: bigint; expectedPayout: bigint | null }[];
  totalNominalMatches: boolean | null;
  allMatch: boolean;
}

export function verifyOdds(c: Pick<PublishedCycle, "barriers" | "levels" | "odds">): boolean {
  for (let b = 0; b < BARRIER_COUNT; b++) {
    for (let l = 0; l < ENERGY_LEVELS; l++) {
      const ppb = transmissionPpb(c.barriers[b].heightMilli, c.barriers[b].widthMilli, c.levels[l].energyBps);
      if (ppb == null || ppb !== c.odds.transmissionPpb[b][l]) return false;
    }
  }
  return true;
}

export function verifyCycle(cycle: PublishedCycle, positions: PublishedPosition[]): CycleVerification {
  const oddsMatchPhysics = verifyOdds(cycle);
  const revealed = !!(cycle.serverSeed && cycle.entropyBlockhash && cycle.randomness);
  const fairness = revealed
    ? verifyCycleFairness({ id: cycle.id, seedCommitment: cycle.seedCommitment, serverSeed: cycle.serverSeed!, entropyBlockhash: cycle.entropyBlockhash!, randomness: cycle.randomness! })
    : null;
  const randomness = revealed ? fromHex(cycle.randomness!) : null;

  let total = 0n;
  const out = positions.map((p) => {
    const expectedSuccesses = Array.from({ length: BARRIER_COUNT }, () => Array(ENERGY_LEVELS).fill(0) as number[]);
    let nominal = 0n;
    if (randomness) {
      const owner = decodeBase58(p.wallet);
      for (let b = 0; b < BARRIER_COUNT; b++) {
        for (let l = 0; l < ENERGY_LEVELS; l++) {
          const n = p.particles[b][l];
          if (!n) continue;
          const s = particleOutcomes(randomness, cycle.id, owner, b, l, n, cycle.odds.transmissionPpb[b][l]).filter((o) => o.success).length;
          expectedSuccesses[b][l] = s;
          nominal += BigInt(s) * cycle.odds.reward[b][l];
        }
      }
    }
    total += nominal;
    const expectedPayout = randomness ? computePayout({ outcome: cycle.outcome, totalNominal: cycle.totalNominal, emissionBudget: cycle.emissionBudget, positionNominal: nominal }) : null;
    const matches =
      !randomness ||
      (expectedSuccesses.every((row, b) => row.every((s, l) => s === p.successes[b][l])) &&
        nominal === p.nominalReward &&
        (p.payout == null || p.payout === expectedPayout));
    return { wallet: p.wallet, matches, expectedSuccesses, expectedNominal: nominal, expectedPayout };
  });

  const totalNominalMatches = randomness ? total === cycle.totalNominal : null;
  return {
    oddsMatchPhysics,
    commitmentMatches: fairness?.commitmentMatches ?? null,
    randomnessMatches: fairness?.randomnessMatches ?? null,
    positions: out,
    totalNominalMatches,
    allMatch: oddsMatchPhysics && fairness?.commitmentMatches !== false && fairness?.randomnessMatches !== false && totalNominalMatches !== false && out.every((p) => p.matches),
  };
}
