import { BARRIER_COUNT, ENERGY_LEVELS, computePayout, particleOutcomes, type CycleAccount, type PositionAccount } from "@tunnel/sdk";

export interface RevealParticle {
  barrier: number;
  level: number;
  index: number;
  success: boolean;
  ppb: number;
}

export interface RevealPlan {
  cycleId: bigint;
  particles: RevealParticle[];
  successes: number;
  total: number;
  /** Final $TUNNEL payout; null while the cycle is not finalized (pro-rata scaling depends on everyone). */
  payout: bigint | null;
  nominal: bigint;
  /** Recomputed outcomes agree with the counts the program recorded for this position. */
  verified: boolean;
}

/**
 * Derives the particle-by-particle outcomes of a *settled* position from the
 * cycle's onchain randomness, and checks them against what the program
 * recorded. Returns null before settlement: nothing is ever shown early.
 */
export function planReveal(cycle: CycleAccount, position: PositionAccount): RevealPlan | null {
  if (!position.settled || !cycle.randomness.some((b) => b !== 0)) return null;
  const particles: RevealParticle[] = [];
  let verified = true;
  for (let b = 0; b < BARRIER_COUNT; b++) {
    for (let l = 0; l < ENERGY_LEVELS; l++) {
      const n = position.particles[b][l];
      if (!n) continue;
      const ppb = cycle.odds.transmissionPpb[b][l];
      const outs = particleOutcomes(cycle.randomness, cycle.id, position.owner.toBytes(), b, l, n, ppb);
      if (outs.filter((o) => o.success).length !== position.successes[b][l]) verified = false;
      particles.push(...outs.map((o) => ({ barrier: b, level: l, index: o.index, success: o.success, ppb })));
    }
  }
  const successes = particles.filter((p) => p.success).length;
  const payout = cycle.status === "settled" ? computePayout({ outcome: cycle.outcome, totalNominal: cycle.totalNominal, emissionBudget: cycle.emissionBudget, positionNominal: position.nominalReward }) : null;
  return { cycleId: cycle.id, particles, successes, total: particles.length, payout, nominal: position.nominalReward, verified };
}

const KEY = "tunnel:revealed";

/** Which cycles' reveals this browser has already played (convenience only; outcomes come from chain). */
export function wasRevealed(cycleId: bigint): boolean {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]).includes(cycleId.toString());
  } catch {
    return false;
  }
}

export function markRevealed(cycleId: bigint) {
  try {
    const list = new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
    list.add(cycleId.toString());
    localStorage.setItem(KEY, JSON.stringify([...list].slice(-200)));
  } catch {
    /* storage unavailable */
  }
}
