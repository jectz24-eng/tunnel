import { Keypair } from "@solana/web3.js";
import { DEFAULT_PARAMS, deriveOdds, particleOutcomes } from "@tunnel/sdk";
import { describe, expect, it } from "vitest";
import { planReveal } from "@/lib/reveal";
import type { CycleAccount, PositionAccount } from "@/lib/types";

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
    id: 3n,
    status,
    outcome: status === "settled" ? (nominal > 0n ? "rewards" : "noTunnels") : "pending",
    barriers: DEFAULT_PARAMS.barriers,
    levels: DEFAULT_PARAMS.levels,
    odds,
    randomness: settled ? randomness : null,
  } as unknown as CycleAccount;
  const position = {
    owner: owner.toBase58(),
    cycleId: 3n,
    particles,
    successes,
    settled,
    nominalReward: nominal,
    payout: settled ? nominal / 2n : null,
  } as unknown as PositionAccount;
  return { cycle, position, nominal, successes };
}

describe("reveal planning", () => {
  it("reveals nothing before the cycle is settled", () => {
    const { cycle, position } = fixture("closed", false);
    expect(planReveal(cycle, position)).toBeNull();
  });

  it("re-derives every particle from the randomness and matches the recorded counts", () => {
    const { cycle, position, successes } = fixture("settled", true);
    const plan = planReveal(cycle, position)!;
    expect(plan.total).toBe(18);
    expect(plan.successes).toBe(successes[0][4] + successes[2][0]);
    expect(plan.verified).toBe(true);
  });

  it("shows the payout recorded at settlement", () => {
    const settled = fixture("settled", true);
    expect(planReveal(settled.cycle, settled.position)!.payout).toBe(settled.nominal / 2n);
  });

  it("flags tampered recorded counts", () => {
    const { cycle, position } = fixture("settled", true);
    position.successes[0][4] += 1;
    expect(planReveal(cycle, position)!.verified).toBe(false);
  });
});
