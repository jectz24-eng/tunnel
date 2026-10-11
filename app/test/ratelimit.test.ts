import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("rate limiter (in-memory fallback)", () => {
  const prev = process.env.DATABASE_URL;
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    vi.useFakeTimers();
  });
  afterEach(() => {
    process.env.DATABASE_URL = prev;
    vi.useRealTimers();
  });

  it("allows up to the limit per window, then refuses until the window resets", async () => {
    const { rateLimit } = await import("@/server/ratelimit");
    const key = `t:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect((await rateLimit(key, 3, 60_000)).allowed).toBe(true);
    expect((await rateLimit(key, 3, 60_000)).allowed).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect((await rateLimit(key, 3, 60_000)).allowed).toBe(true);
  });

  it("keeps keys independent", async () => {
    const { rateLimit } = await import("@/server/ratelimit");
    expect((await rateLimit("a:1", 1, 60_000)).allowed).toBe(true);
    expect((await rateLimit("a:2", 1, 60_000)).allowed).toBe(true);
    expect((await rateLimit("a:1", 1, 60_000)).allowed).toBe(false);
  });
});
