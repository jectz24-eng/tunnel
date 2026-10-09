import type { RoundAccount } from "@tunnel/sdk";
import { describe, expect, it } from "vitest";
import { displayStatus, formatCountdown } from "@/lib/round";
import { explainError } from "@/lib/tx";

const round = (o: Partial<RoundAccount>) => ({ status: "open", openTs: 100, closeTs: 160, ...o }) as RoundAccount;

describe("displayStatus — the seven user-facing states", () => {
  it("derives UPCOMING / OPEN / CLOSED from the chain clock while onchain status is Open", () => {
    expect(displayStatus(round({}), 99)).toBe("UPCOMING");
    expect(displayStatus(round({}), 100)).toBe("OPEN");
    expect(displayStatus(round({}), 159.9)).toBe("OPEN");
    expect(displayStatus(round({}), 160)).toBe("CLOSED");
  });
  it("maps every later onchain status", () => {
    expect(displayStatus(round({ status: "closed" }), 0)).toBe("CLOSED");
    expect(displayStatus(round({ status: "awaitingRandomness" }), 0)).toBe("AWAITING RANDOMNESS");
    expect(displayStatus(round({ status: "resolving" }), 0)).toBe("RESOLVING");
    expect(displayStatus(round({ status: "settled" }), 0)).toBe("SETTLED");
    expect(displayStatus(round({ status: "failed" }), 0)).toBe("FAILED");
  });
});

describe("formatCountdown", () => {
  it("formats and clamps", () => {
    expect(formatCountdown(61.2)).toBe("01:02");
    expect(formatCountdown(-5)).toBe("00:00");
  });
});

describe("explainError", () => {
  it("surfaces the program's own error message", () => {
    const e = Object.assign(new Error("Simulation failed"), {
      logs: ["Program log: AnchorError caused by account: round. Error Code: RoundExpired. Error Number: 6009. Error Message: Round deposit window has ended."],
    });
    expect(explainError(e)).toBe("Round deposit window has ended");
  });
  it("decodes custom program error codes via the IDL", () => {
    expect(explainError(new Error("failed to send transaction: custom program error: 0x1771"))).toBe("Protocol is paused");
  });
  it("explains wallet rejections and expiry plainly", () => {
    expect(explainError(new Error("User rejected the request."))).toMatch(/declined/);
    expect(explainError(new Error("Blockhash not found"))).toMatch(/expired/);
  });
});
