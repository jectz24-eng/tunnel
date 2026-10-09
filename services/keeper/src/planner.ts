/**
 * Pure decision logic for the permissionless crank. Given a round's onchain
 * state and the chain clock, returns the single next instruction to send.
 * The program enforces every rule independently; this only decides *when*
 * to ask, so a wrong decision costs a failed transaction, never funds.
 */
import type { RoundAccount } from "@tunnel/sdk";

export type RoundAction =
  | { kind: "close" }
  | { kind: "request" }
  | { kind: "reveal" }
  | { kind: "recover" }
  | { kind: "settle"; owners: string[] }
  | { kind: "finalize" }
  | { kind: "sweep" }
  | { kind: "wait"; reason: string }
  | { kind: "done" };

export interface PlanInput {
  round: Pick<
    RoundAccount,
    | "status"
    | "outcome"
    | "closeTs"
    | "closedTs"
    | "randomnessRequestedTs"
    | "randomnessTimeoutSecs"
    | "participants"
    | "positionsSettled"
    | "claims"
    | "swept"
  >;
  now: number;
  /** Whether ORAO has fulfilled this round's seed (only relevant while awaiting). */
  randomnessFulfilled?: boolean;
  /** Owners of positions not yet settled (only relevant while resolving). */
  unsettledOwners?: string[];
}

export function planRoundAction({ round: r, now, randomnessFulfilled, unsettledOwners }: PlanInput): RoundAction {
  const timeout = r.randomnessTimeoutSecs;
  switch (r.status) {
    case "open":
      if (now < r.closeTs) return { kind: "wait", reason: "deposit window open" };
      if (r.participants > 0 && now > r.closeTs + timeout) return { kind: "recover" };
      return { kind: "close" };
    case "closed":
      if (randomnessFulfilled) return { kind: "reveal" };
      if (now > r.closedTs + timeout) return { kind: "recover" };
      return { kind: "request" };
    case "awaitingRandomness":
      if (randomnessFulfilled) return { kind: "reveal" };
      if (now > r.randomnessRequestedTs + timeout) return { kind: "recover" };
      return { kind: "wait", reason: "awaiting ORAO fulfillment" };
    case "resolving":
      if (r.positionsSettled < r.participants) {
        const owners = unsettledOwners ?? [];
        return owners.length ? { kind: "settle", owners } : { kind: "wait", reason: "loading unsettled positions" };
      }
      return { kind: "finalize" };
    case "settled":
    case "failed":
      if (r.swept) return { kind: "done" };
      if (r.claims >= r.participants) return { kind: "sweep" };
      return { kind: "wait", reason: "unclaimed positions" };
  }
}

/** Should a new round be opened right now? Mirrors the program's scheduling rule. */
export function shouldOpenRound(p: { paused: boolean; nextRoundId: bigint; lastRoundOpenTs: number }, now: number) {
  if (p.paused) return false;
  return p.nextRoundId === 0n || now >= p.lastRoundOpenTs;
}
