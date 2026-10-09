import { describe, expect, it } from "vitest";
import { planRoundAction, shouldOpenRound, type PlanInput } from "../src/planner";

const base: PlanInput["round"] = {
  status: "open",
  outcome: "pending",
  closeTs: 1_000,
  closedTs: 0,
  randomnessRequestedTs: 0,
  randomnessTimeoutSecs: 600,
  participants: 2,
  positionsSettled: 0,
  claims: 0,
  swept: false,
};

const plan = (round: Partial<PlanInput["round"]>, now: number, extra: Partial<PlanInput> = {}) =>
  planRoundAction({ round: { ...base, ...round }, now, ...extra });

describe("planRoundAction", () => {
  it("never closes a round before close_ts", () => {
    expect(plan({}, 999).kind).toBe("wait");
    expect(plan({}, 1_000).kind).toBe("close");
  });

  it("closes empty rounds even long after close_ts (they settle immediately)", () => {
    expect(plan({ participants: 0 }, 100_000).kind).toBe("close");
  });

  it("recovers a funded round that was never closed within the timeout", () => {
    expect(plan({}, 1_601).kind).toBe("recover");
  });

  it("requests randomness for closed rounds, reveals if already fulfilled", () => {
    expect(plan({ status: "closed", closedTs: 1_001 }, 1_002).kind).toBe("request");
    expect(plan({ status: "closed", closedTs: 1_001 }, 1_002, { randomnessFulfilled: true }).kind).toBe("reveal");
    expect(plan({ status: "closed", closedTs: 1_001 }, 1_602).kind).toBe("recover");
  });

  it("waits for ORAO, then reveals; recovers after timeout", () => {
    const r = { status: "awaitingRandomness" as const, randomnessRequestedTs: 2_000 };
    expect(plan(r, 2_010, { randomnessFulfilled: false }).kind).toBe("wait");
    expect(plan(r, 2_010, { randomnessFulfilled: true }).kind).toBe("reveal");
    expect(plan(r, 2_601, { randomnessFulfilled: false }).kind).toBe("recover");
    // Fulfilled randomness always wins over recovery.
    expect(plan(r, 9_999, { randomnessFulfilled: true }).kind).toBe("reveal");
  });

  it("settles outstanding positions before finalizing", () => {
    expect(plan({ status: "resolving", positionsSettled: 1 }, 0, { unsettledOwners: ["a"] })).toEqual({ kind: "settle", owners: ["a"] });
    expect(plan({ status: "resolving", positionsSettled: 2 }, 0).kind).toBe("finalize");
  });

  it("sweeps only after every participant claimed", () => {
    expect(plan({ status: "settled", outcome: "rewards", claims: 1 }, 0).kind).toBe("wait");
    expect(plan({ status: "settled", outcome: "rewards", claims: 2 }, 0).kind).toBe("sweep");
    expect(plan({ status: "failed", outcome: "fullRefund", claims: 2 }, 0).kind).toBe("sweep");
    expect(plan({ status: "settled", claims: 2, swept: true }, 0).kind).toBe("done");
  });
});

describe("shouldOpenRound", () => {
  it("opens the first round and at most one upcoming round", () => {
    expect(shouldOpenRound({ paused: false, nextRoundId: 0n, lastRoundOpenTs: 0 }, 5)).toBe(true);
    expect(shouldOpenRound({ paused: false, nextRoundId: 3n, lastRoundOpenTs: 100 }, 99)).toBe(false);
    expect(shouldOpenRound({ paused: false, nextRoundId: 3n, lastRoundOpenTs: 100 }, 100)).toBe(true);
  });
  it("does not open rounds while paused", () => {
    expect(shouldOpenRound({ paused: true, nextRoundId: 0n, lastRoundOpenTs: 0 }, 5)).toBe(false);
  });
});
