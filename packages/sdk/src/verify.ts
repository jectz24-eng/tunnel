/**
 * Independent verification of a settled cycle. Given only onchain data (the
 * Cycle account and its Position accounts), recompute every particle outcome
 * and every payout, and compare them to what the program recorded. Also
 * re-derives the cycle's odds table from its physical barrier parameters.
 */
import type { CycleAccount, PositionAccount } from "./accounts";
import { BARRIER_COUNT, ENERGY_LEVELS } from "./constants";
import { computePayout, particleOutcomes, type ParticleOutcome } from "./math";
import { transmissionPpb } from "./physics";

export interface PositionVerification {
  owner: string;
  particles: ParticleOutcome[];
  expectedSuccesses: number[][];
  recordedSuccesses: number[][];
  expectedNominal: bigint;
  expectedPayout: bigint | null;
  matches: boolean;
}

export interface CycleVerification {
  cycleId: bigint;
  /** Each snapshotted probability equals the physics model applied to the snapshotted barrier. */
  oddsMatchPhysics: boolean;
  totalNominalMatches: boolean;
  positions: PositionVerification[];
  allMatch: boolean;
}

export function verifyOdds(cycle: Pick<CycleAccount, "barriers" | "levels" | "odds">): boolean {
  for (let b = 0; b < BARRIER_COUNT; b++) {
    for (let l = 0; l < ENERGY_LEVELS; l++) {
      const ppb = transmissionPpb(cycle.barriers[b].heightMilli, cycle.barriers[b].widthMilli, cycle.levels[l].energyBps);
      // The program evaluates the same expression in soft-float; allow one ppb of libm/V8 rounding difference.
      if (ppb == null || Math.abs(ppb - cycle.odds.transmissionPpb[b][l]) > 1) return false;
    }
  }
  return true;
}

export function verifyCycle(cycle: CycleAccount, positions: PositionAccount[]): CycleVerification {
  const randomnessKnown = cycle.randomness.some((b) => b !== 0);
  const out: PositionVerification[] = [];
  let totalNominal = 0n;

  for (const p of positions) {
    const particles: ParticleOutcome[] = [];
    const successes = Array.from({ length: BARRIER_COUNT }, () => Array(ENERGY_LEVELS).fill(0) as number[]);
    let nominal = 0n;
    if (randomnessKnown) {
      for (let b = 0; b < BARRIER_COUNT; b++) {
        for (let l = 0; l < ENERGY_LEVELS; l++) {
          const n = p.particles[b][l];
          if (!n) continue;
          const outs = particleOutcomes(cycle.randomness, cycle.id, p.owner.toBytes(), b, l, n, cycle.odds.transmissionPpb[b][l]);
          particles.push(...outs);
          successes[b][l] = outs.filter((o) => o.success).length;
          nominal += BigInt(successes[b][l]) * cycle.odds.reward[b][l];
        }
      }
    }
    totalNominal += nominal;
    const expectedPayout =
      cycle.status === "settled" || cycle.status === "void"
        ? computePayout({ outcome: cycle.outcome, totalNominal: cycle.totalNominal, emissionBudget: cycle.emissionBudget, positionNominal: nominal })
        : null;
    const settledMatches =
      !p.settled || (successes.every((row, b) => row.every((s, l) => s === p.successes[b][l])) && nominal === p.nominalReward);
    const paidMatches = !p.claimed || expectedPayout == null || expectedPayout === p.tokensPaid;
    out.push({
      owner: p.owner.toBase58(),
      particles,
      expectedSuccesses: successes,
      recordedSuccesses: p.successes,
      expectedNominal: nominal,
      expectedPayout,
      matches: settledMatches && paidMatches,
    });
  }

  const oddsMatchPhysics = verifyOdds(cycle);
  // Positions that already claimed are closed onchain, so the sum only covers
  // what is still open; the total can be checked exactly once none are closed.
  const totalNominalMatches = cycle.status !== "settled" || cycle.claims > 0 || cycle.totalNominal === totalNominal;
  return {
    cycleId: cycle.id,
    oddsMatchPhysics,
    totalNominalMatches,
    positions: out,
    allMatch: oddsMatchPhysics && totalNominalMatches && out.every((p) => p.matches),
  };
}
