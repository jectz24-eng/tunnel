/**
 * Independent verification of a settled round. Given only onchain data
 * (the Round account and its Position accounts), recompute every particle
 * outcome and every payout, and compare them to what the program recorded.
 */
import type { PositionAccount, RoundAccount } from "./accounts";
import { computePayout, particleOutcomes, splitFee, type ParticleOutcome } from "./math";

export interface PositionVerification {
  owner: string;
  particles: ParticleOutcome[];
  expectedSuccesses: number[];
  recordedSuccesses: number[];
  expectedWeight: bigint;
  expectedPayout: { lamports: bigint; tokens: bigint } | null;
  matches: boolean;
}

export interface RoundVerification {
  roundId: bigint;
  feeMatches: boolean;
  totalWeightMatches: boolean;
  positions: PositionVerification[];
  allMatch: boolean;
}

export function verifyRound(round: RoundAccount, positions: PositionAccount[]): RoundVerification {
  const randomnessKnown = round.randomness.some((b) => b !== 0);
  const out: PositionVerification[] = [];
  let totalWeight = 0n;

  for (const p of positions) {
    const particles: ParticleOutcome[] = [];
    const successes = [0, 0, 0];
    let weight = 0n;
    if (randomnessKnown) {
      for (let b = 0; b < 3; b++) {
        const outs = particleOutcomes(round.randomness, round.id, p.owner.toBytes(), b, p.particles[b], round.barriers[b].transmissionBps);
        particles.push(...outs);
        successes[b] = outs.filter((o) => o.success).length;
        weight += BigInt(successes[b]) * BigInt(round.barriers[b].rewardWeight);
      }
    }
    totalWeight += weight;
    const expectedPayout =
      round.status === "settled" || round.status === "failed"
        ? computePayout({
            outcome: round.outcome,
            distributableLamports: round.distributableLamports,
            totalLamports: round.totalLamports,
            totalSuccessWeight: round.totalSuccessWeight,
            emissionBudget: round.emissionBudget,
            positionLamports: p.lamports,
            positionSuccessWeight: weight,
          })
        : null;
    const settledMatches = !p.settled || (successes.every((s, i) => s === p.successes[i]) && weight === p.successWeight);
    const paidMatches =
      !p.claimed || !expectedPayout || (expectedPayout.lamports === p.lamportsPaid && expectedPayout.tokens === p.tokensPaid);
    out.push({
      owner: p.owner.toBase58(),
      particles,
      expectedSuccesses: successes,
      recordedSuccesses: p.successes,
      expectedWeight: weight,
      expectedPayout,
      matches: settledMatches && paidMatches,
    });
  }

  const { fee } = splitFee(round.totalLamports, round.protocolFeeBps);
  const feeMatches = round.status !== "settled" || round.outcome === "empty" || round.feeLamports === fee;
  const totalWeightMatches = round.status !== "settled" || round.totalSuccessWeight === totalWeight;
  return {
    roundId: round.id,
    feeMatches,
    totalWeightMatches,
    positions: out,
    allMatch: feeMatches && totalWeightMatches && out.every((p) => p.matches),
  };
}
