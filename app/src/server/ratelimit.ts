import "server-only";
import { getDb, hasDatabase } from "@tunnel/db";

const memory = new Map<string, { count: number; windowEnd: number }>();

/**
 * Fixed-window rate limiter. Uses the database (shared across app instances)
 * when configured, otherwise a per-process map. Returns whether the call is
 * allowed and how many remain in the window.
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const now = Date.now();
  if (hasDatabase()) {
    try {
      const rows = await getDb().$queryRaw<{ count: number; windowEnd: Date }[]>`
        INSERT INTO "RateLimit" ("key", "count", "windowEnd")
        VALUES (${key}, 1, ${new Date(now + windowMs)})
        ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE WHEN "RateLimit"."windowEnd" < ${new Date(now)} THEN 1 ELSE "RateLimit"."count" + 1 END,
          "windowEnd" = CASE WHEN "RateLimit"."windowEnd" < ${new Date(now)} THEN ${new Date(now + windowMs)} ELSE "RateLimit"."windowEnd" END
        RETURNING "count", "windowEnd"`;
      const { count, windowEnd } = rows[0];
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt: windowEnd };
    } catch (e) {
      console.error("[ratelimit] database unavailable, using in-memory window", e);
    }
  }
  const cur = memory.get(key);
  const entry = !cur || cur.windowEnd < now ? { count: 1, windowEnd: now + windowMs } : { count: cur.count + 1, windowEnd: cur.windowEnd };
  memory.set(key, entry);
  if (memory.size > 50_000) for (const [k, v] of memory) if (v.windowEnd < now) memory.delete(k);
  return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count), resetAt: new Date(entry.windowEnd) };
}

/** Best-effort client IP (first X-Forwarded-For hop when behind a trusted proxy). */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
