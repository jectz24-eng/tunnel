"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { fetchCyclePositions, verifyCycle, type CycleAccount } from "@tunnel/sdk";
import { appConfig } from "./config";
import { usePoll } from "./poll";

export type DisplayStatus = "UPCOMING" | "OPEN" | "CLOSING" | "AWAITING RANDOMNESS" | "RESOLVING" | "SETTLED" | "VOID";

/** Maps onchain status + chain clock to the user-facing cycle states. */
export function displayStatus(c: CycleAccount, now: number): DisplayStatus {
  switch (c.status) {
    case "open":
      if (now < c.openTs) return "UPCOMING";
      return now < c.closeTs ? "OPEN" : "CLOSING";
    case "closed":
      return "CLOSING";
    case "awaitingRandomness":
      return "AWAITING RANDOMNESS";
    case "resolving":
      return "RESOLVING";
    case "settled":
      return "SETTLED";
    case "void":
      return "VOID";
  }
}

export const statusTone: Record<DisplayStatus, "cyan" | "flare" | "amber" | "violet" | "red" | "neutral" | "ion"> = {
  UPCOMING: "neutral",
  OPEN: "cyan",
  CLOSING: "amber",
  "AWAITING RANDOMNESS": "violet",
  RESOLVING: "ion",
  SETTLED: "flare",
  VOID: "red",
};

export const outcomeLabel: Record<CycleAccount["outcome"], string> = {
  pending: "Pending",
  rewards: "Particles tunneled",
  noTunnels: "All reflected",
  void: "Void · randomness timeout",
  empty: "No participants",
};

export function formatCountdown(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Re-verifies a settled cycle in the browser: recomputes every open
 * position's particle outcomes from the onchain randomness and checks them,
 * the payouts and the odds table (against the physics model) with the SDK.
 */
export function useCycleVerification(cycle: CycleAccount | null) {
  const { connection } = useConnection();
  const ready = cycle && (cycle.status === "settled" || cycle.status === "resolving") && cycle.participants > 0;
  return usePoll(
    ready ? `verify:${cycle!.id}:${cycle!.status}:${cycle!.claims}` : null,
    async () => {
      const positions = await fetchCyclePositions(connection, cycle!.id, appConfig.programId);
      return { positions, verification: verifyCycle(cycle!, positions) };
    },
    60_000,
  );
}
