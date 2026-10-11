/**
 * Pure decision logic for the permissionless crank. Given a cycle's onchain
 * state and the chain clock, returns the single next instruction to send.
 * The program enforces every rule independently; this only decides *when*
 * to ask, so a wrong decision costs a failed transaction, never rewards.
 */
import type { CycleAccount } from "@tunnel/sdk";

export type CycleAction =
  | { kind: "close" }
  | { kind: "request" }
  | { kind: "reveal" }
  | { kind: "void" }
  | { kind: "settle"; owners: string[] }
  | { kind: "finalize" }
  | { kind: "sweep" }
  | { kind: "wait"; reason: string }
  | { kind: "done" };

export interface PlanInput {
  cycle: Pick<
    CycleAccount,
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
  /** Whether ORAO has fulfilled this cycle's seed (only relevant while awaiting). */
  randomnessFulfilled?: boolean;
  /** Owners of positions not yet settled (only relevant while resolving). */
  unsettledOwners?: string[];
}

export function planCycleAction({ cycle: c, now, randomnessFulfilled, unsettledOwners }: PlanInput): CycleAction {
  const timeout = c.randomnessTimeoutSecs;
  switch (c.status) {
    case "open":
      if (now < c.closeTs) return { kind: "wait", reason: "deployment window open" };
      if (c.participants > 0 && now > c.closeTs + timeout) return { kind: "void" };
      return { kind: "close" };
    case "closed":
      if (randomnessFulfilled) return { kind: "reveal" };
      if (now > c.closedTs + timeout) return { kind: "void" };
      return { kind: "request" };
    case "awaitingRandomness":
      if (randomnessFulfilled) return { kind: "reveal" };
      if (now > c.randomnessRequestedTs + timeout) return { kind: "void" };
      return { kind: "wait", reason: "awaiting ORAO fulfillment" };
    case "resolving":
      if (c.positionsSettled < c.participants) {
        const owners = unsettledOwners ?? [];
        return owners.length ? { kind: "settle", owners } : { kind: "wait", reason: "loading unsettled positions" };
      }
      return { kind: "finalize" };
    case "settled":
    case "void":
      if (c.swept) return { kind: "done" };
      if (c.claims >= c.participants) return { kind: "sweep" };
      return { kind: "wait", reason: "unclaimed positions" };
  }
}

/** Should a new cycle be opened right now? Mirrors the program's scheduling rule. */
export function shouldOpenCycle(p: { paused: boolean; nextCycleId: bigint; lastCycleOpenTs: number }, now: number) {
  if (p.paused) return false;
  return p.nextCycleId === 0n || now >= p.lastCycleOpenTs;
}
