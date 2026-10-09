"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { fetchRoundPositions, verifyRound, type RoundAccount } from "@tunnel/sdk";
import { appConfig } from "./config";
import { usePoll } from "./poll";

export type DisplayStatus = "UPCOMING" | "OPEN" | "CLOSED" | "AWAITING RANDOMNESS" | "RESOLVING" | "SETTLED" | "FAILED";

/** Maps onchain status + chain clock to the seven user-facing round states. */
export function displayStatus(r: RoundAccount, now: number): DisplayStatus {
  switch (r.status) {
    case "open":
      if (now < r.openTs) return "UPCOMING";
      return now < r.closeTs ? "OPEN" : "CLOSED";
    case "closed":
      return "CLOSED";
    case "awaitingRandomness":
      return "AWAITING RANDOMNESS";
    case "resolving":
      return "RESOLVING";
    case "settled":
      return "SETTLED";
    case "failed":
      return "FAILED";
  }
}

export const statusTone: Record<DisplayStatus, "cyan" | "green" | "amber" | "violet" | "red" | "neutral" | "blue"> = {
  UPCOMING: "neutral",
  OPEN: "cyan",
  CLOSED: "amber",
  "AWAITING RANDOMNESS": "violet",
  RESOLVING: "blue",
  SETTLED: "green",
  FAILED: "red",
};

export const outcomeLabel: Record<RoundAccount["outcome"], string> = {
  pending: "Pending",
  rewards: "Rewards",
  noSuccessRefund: "No tunnels · 95% refund",
  fullRefund: "Failed · full refund",
  empty: "No participants",
};

export function formatCountdown(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Per-barrier particle outcomes of a settled round, derived from its onchain
 * randomness and cross-checked against the success counts the program
 * recorded for every position. Returns null if anything disagrees.
 */
export function useVerifiedOutcomes(round: RoundAccount | null) {
  const { connection } = useConnection();
  const ready = round && round.status === "settled" && round.outcome !== "empty" && round.participants > 0;
  return usePoll(
    ready ? `outcomes:${round!.id}` : null,
    async () => {
      const positions = await fetchRoundPositions(connection, round!.id, appConfig.programId);
      const v = verifyRound(round!, positions);
      if (!v.positions.every((p) => p.matches)) return { verified: false as const, outcomes: null, positions: positions.length };
      const outcomes: boolean[][] = [[], [], []];
      for (const p of v.positions) for (const o of p.particles) outcomes[o.barrier].push(o.success);
      // Positions that already claimed are closed onchain; their particles are still counted in the round totals.
      const shown = outcomes.reduce((a, l) => a + l.length, 0);
      const total = round!.particles.reduce((a, b) => a + Number(b), 0);
      return { verified: true as const, outcomes, positions: positions.length, complete: shown === total };
    },
    60_000,
  );
}
