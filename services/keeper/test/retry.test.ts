import { describe, expect, it, vi } from "vitest";
import { anchorErrorName, isTransientError, withRetry } from "../src/retry";

const noSleep = () => Promise.resolve();

describe("withRetry", () => {
  it("retries transient RPC failures and then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockResolvedValue("sig");
    await expect(withRetry(fn, { sleep: noSleep })).resolves.toBe("sig");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry program errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("AnchorError ... Error Code: RoundStillOpen."));
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toThrow("RoundStillOpen");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after the attempt limit during an RPC outage", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    await expect(withRetry(fn, { attempts: 4, sleep: noSleep })).rejects.toThrow("ECONNRESET");
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("re-sends after blockhash expiry (transaction retry)", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("TransactionExpiredBlockheightExceededError: block height exceeded")).mockResolvedValue("ok");
    await expect(withRetry(fn, { sleep: noSleep })).resolves.toBe("ok");
  });
});

describe("error classification", () => {
  it("classifies errors", () => {
    expect(isTransientError(new Error("503 Service Unavailable"))).toBe(true);
    expect(isTransientError(new Error("custom program error: 0x1770"))).toBe(false);
  });
  it("extracts Anchor error names from logs", () => {
    const e = Object.assign(new Error("Simulation failed"), { logs: ["Program log: AnchorError occurred. Error Code: AlreadyClaimed. Error Number: 6021."] });
    expect(anchorErrorName(e)).toBe("AlreadyClaimed");
    expect(anchorErrorName(new Error("x"))).toBeNull();
  });
});
