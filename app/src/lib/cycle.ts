"use client";

import { verifyCycle } from "@tunnel/sdk";
import { getJson } from "./api";
import { usePoll } from "./poll";
import { parsePosition, type CycleAccount } from "./types";

export type DisplayStatus = "OPEN" | "CLOSING" | "AWAITING ENTROPY" | "SETTLED" | "VOID";

/** Maps server status + server clock to the user-facing cycle states. */
export function displayStatus(c: CycleAccount, now: number): DisplayStatus {
  switch (c.status) {
    case "open":
      return now < c.closeTs ? "OPEN" : "CLOSING";
    case "closed":
      return "AWAITING ENTROPY";
    case "settled":
      return "SETTLED";
    case "void":
      return "VOID";
  }
}

export const statusTone: Record<DisplayStatus, "cyan" | "flare" | "amber" | "violet" | "red" | "neutral" | "ion"> = {
  OPEN: "cyan",
  CLOSING: "amber",
  "AWAITING ENTROPY": "violet",
  SETTLED: "flare",
  VOID: "red",
};

export const outcomeLabel: Record<CycleAccount["outcome"], string> = {
  pending: "Pending",
  rewards: "Particles tunneled",
  noTunnels: "All reflected",
  void: "Void · not settled",
  empty: "No participants",
};

export function formatCountdown(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Re-verifies a settled cycle in the browser: checks the revealed seed against
 * the commitment published at open, re-derives the randomness from the seed
 * and the Solana blockhash, recomputes every particle and payout, and checks
 * the odds table against the physics model.
 */
export function useCycleVerification(cycle: CycleAccount | null) {
  const ready = cycle && cycle.status === "settled" && cycle.participants > 0;
  return usePoll(
    ready ? `verify:${cycle!.id}` : null,
    async () => {
      const r = await getJson<{ positions: Record<string, unknown>[] }>(`/api/cycles/${cycle!.id}`);
      const positions = (r.data?.positions ?? []).map(parsePosition);
      const verification = verifyCycle(
        {
          id: cycle!.id,
          barriers: cycle!.barriers,
          levels: cycle!.levels,
          odds: cycle!.odds,
          emissionBudget: cycle!.emissionBudget,
          totalNominal: cycle!.totalNominal,
          outcome: cycle!.outcome,
          seedCommitment: cycle!.seedCommitment,
          serverSeed: cycle!.serverSeed,
          entropyBlockhash: cycle!.entropyBlockhash,
          randomness: cycle!.randomnessHex,
        },
        positions.map((p) => ({ wallet: p.owner, particles: p.particles, successes: p.successes, nominalReward: p.nominalReward, payout: p.payout })),
      );
      return { positions, verification };
    },
    60_000,
  );
}
