import { BARRIER_COUNT, ENERGY_LEVELS, decodeBase58, particleOutcomes } from "@tunnel/sdk";
import type { CycleAccount, PositionAccount } from "./types";

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
  /** Final $TUNNEL payout recorded at settlement. */
  payout: bigint | null;
  nominal: bigint;
  /** The browser's own recomputation agrees with the counts the server recorded. */
  verified: boolean;
}

/**
 * Derives the particle-by-particle outcomes of a *settled* position from the
 * cycle's published randomness, and checks them against what the server
 * recorded. Returns null before settlement: nothing is ever shown early.
 */
export function planReveal(cycle: CycleAccount, position: PositionAccount): RevealPlan | null {
  if (!position.settled || cycle.status !== "settled" || !cycle.randomness) return null;
  const particles: RevealParticle[] = [];
  let verified = true;
  const owner = decodeBase58(position.owner);
  for (let b = 0; b < BARRIER_COUNT; b++) {
    for (let l = 0; l < ENERGY_LEVELS; l++) {
      const n = position.particles[b][l];
      if (!n) continue;
      const ppb = cycle.odds.transmissionPpb[b][l];
      const outs = particleOutcomes(cycle.randomness, cycle.id, owner, b, l, n, ppb);
      if (outs.filter((o) => o.success).length !== position.successes[b][l]) verified = false;
      particles.push(...outs.map((o) => ({ barrier: b, level: l, index: o.index, success: o.success, ppb })));
    }
  }
  const successes = particles.filter((p) => p.success).length;
  return { cycleId: cycle.id, particles, successes, total: particles.length, payout: position.payout, nominal: position.nominalReward, verified };
}

const KEY = "tunnel:revealed:v3";

/** Which cycles' reveals this browser has already played (convenience only; outcomes come from the server). */
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
