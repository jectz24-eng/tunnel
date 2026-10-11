import { describe, expect, it } from "vitest";
import { planCycleAction, shouldOpenCycle, type PlanInput } from "../src/planner";

const base: PlanInput["cycle"] = {
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

const plan = (cycle: Partial<PlanInput["cycle"]>, now: number, extra: Partial<PlanInput> = {}) =>
  planCycleAction({ cycle: { ...base, ...cycle }, now, ...extra });

describe("planCycleAction", () => {
  it("never closes a cycle before close_ts", () => {
    expect(plan({}, 999).kind).toBe("wait");
    expect(plan({}, 1_000).kind).toBe("close");
  });

  it("closes empty cycles even long after close_ts (they settle immediately)", () => {
    expect(plan({ participants: 0 }, 100_000).kind).toBe("close");
  });

  it("voids a cycle with particles that was never closed within the timeout", () => {
    expect(plan({}, 1_601).kind).toBe("void");
  });

  it("requests randomness for closed cycles, reveals if already fulfilled", () => {
    expect(plan({ status: "closed", closedTs: 1_001 }, 1_002).kind).toBe("request");
    expect(plan({ status: "closed", closedTs: 1_001 }, 1_002, { randomnessFulfilled: true }).kind).toBe("reveal");
    expect(plan({ status: "closed", closedTs: 1_001 }, 1_602).kind).toBe("void");
  });

  it("waits for ORAO, then reveals; voids after timeout", () => {
    const r = { status: "awaitingRandomness" as const, randomnessRequestedTs: 2_000 };
    expect(plan(r, 2_010, { randomnessFulfilled: false }).kind).toBe("wait");
    expect(plan(r, 2_010, { randomnessFulfilled: true }).kind).toBe("reveal");
    expect(plan(r, 2_601, { randomnessFulfilled: false }).kind).toBe("void");
    // Fulfilled randomness always wins over voiding.
    expect(plan(r, 9_999, { randomnessFulfilled: true }).kind).toBe("reveal");
  });

  it("settles outstanding positions before finalizing", () => {
    expect(plan({ status: "resolving", positionsSettled: 1 }, 0, { unsettledOwners: ["a"] })).toEqual({ kind: "settle", owners: ["a"] });
    expect(plan({ status: "resolving", positionsSettled: 2 }, 0).kind).toBe("finalize");
  });

  it("sweeps only after every participant claimed", () => {
    expect(plan({ status: "settled", outcome: "rewards", claims: 1 }, 0).kind).toBe("wait");
    expect(plan({ status: "settled", outcome: "rewards", claims: 2 }, 0).kind).toBe("sweep");
    expect(plan({ status: "void", outcome: "void", claims: 2 }, 0).kind).toBe("sweep");
    expect(plan({ status: "settled", claims: 2, swept: true }, 0).kind).toBe("done");
  });
});

describe("shouldOpenCycle", () => {
  it("opens the first cycle and at most one upcoming cycle", () => {
    expect(shouldOpenCycle({ paused: false, nextCycleId: 0n, lastCycleOpenTs: 0 }, 5)).toBe(true);
    expect(shouldOpenCycle({ paused: false, nextCycleId: 3n, lastCycleOpenTs: 100 }, 99)).toBe(false);
    expect(shouldOpenCycle({ paused: false, nextCycleId: 3n, lastCycleOpenTs: 100 }, 100)).toBe(true);
  });
  it("does not open cycles while paused", () => {
    expect(shouldOpenCycle({ paused: true, nextCycleId: 0n, lastCycleOpenTs: 0 }, 5)).toBe(false);
  });
});
