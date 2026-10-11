import { Keypair } from "@solana/web3.js";
import { DEFAULT_PARAMS, cyclePda, deriveOdds, particleOutcomes, type CycleAccount, type PositionAccount } from "@tunnel/sdk";
import { describe, expect, it } from "vitest";
import { planReveal } from "@/lib/reveal";

const odds = deriveOdds(DEFAULT_PARAMS);
const owner = Keypair.generate().publicKey;
const randomness = Uint8Array.from({ length: 64 }, (_, i) => (i * 13 + 5) & 0xff);
const zeros = () => Array.from({ length: 3 }, () => [0, 0, 0, 0, 0]);

function fixture(status: CycleAccount["status"], settled: boolean) {
  const particles = zeros();
  particles[0][4] = 12;
  particles[2][0] = 6;
  const successes = zeros();
  successes[0][4] = particleOutcomes(randomness, 3n, owner.toBytes(), 0, 4, 12, odds.transmissionPpb[0][4]).filter((o) => o.success).length;
  successes[2][0] = particleOutcomes(randomness, 3n, owner.toBytes(), 2, 0, 6, odds.transmissionPpb[2][0]).filter((o) => o.success).length;
  const nominal = BigInt(successes[0][4]) * odds.reward[0][4] + BigInt(successes[2][0]) * odds.reward[2][0];
  const cycle = {
    address: cyclePda(3n), id: 3n, status, outcome: status === "settled" ? (nominal > 0n ? "rewards" : "noTunnels") : "pending",
    barriers: DEFAULT_PARAMS.barriers, levels: DEFAULT_PARAMS.levels, odds, randomness: settled ? randomness : new Uint8Array(64),
    totalNominal: nominal * 4n, emissionBudget: nominal * 2n,
  } as unknown as CycleAccount;
  const position = { owner, cycleId: 3n, particles, successes, settled, nominalReward: nominal, claimed: false } as unknown as PositionAccount;
  return { cycle, position, nominal, successes };
}

describe("reveal planning", () => {
  it("reveals nothing before the position is settled onchain", () => {
    const { cycle, position } = fixture("awaitingRandomness", false);
    expect(planReveal(cycle, position)).toBeNull();
  });

  it("re-derives every particle from the randomness and matches the recorded counts", () => {
    const { cycle, position, successes } = fixture("settled", true);
    const plan = planReveal(cycle, position)!;
    expect(plan.total).toBe(18);
    expect(plan.successes).toBe(successes[0][4] + successes[2][0]);
    expect(plan.verified).toBe(true);
  });

  it("shows the payout only once the cycle is finalized, scaled by the cap", () => {
    const resolving = fixture("resolving", true);
    expect(planReveal(resolving.cycle, resolving.position)!.payout).toBeNull();
    const settled = fixture("settled", true);
    const plan = planReveal(settled.cycle, settled.position)!;
    // total nominal is 4× this position and the budget 2×: the payout is scaled by 1/2.
    expect(plan.payout).toBe(settled.nominal > 0n ? settled.nominal / 2n : 0n);
  });

  it("flags tampered recorded counts", () => {
    const { cycle, position } = fixture("settled", true);
    position.successes[0][4] += 1;
    expect(planReveal(cycle, position)!.verified).toBe(false);
  });
});
