import "server-only";
import { NextResponse } from "next/server";
import { getDb, hasDatabase } from "@tunnel/db";

/** JSON response that serialises bigint as decimal strings. */
export function json(data: unknown, init?: ResponseInit) {
  return new NextResponse(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    ...init,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

/**
 * Runs an indexed-data query. When no database is configured or it is
 * unreachable, responds `{ available: false }` — the UI then says the indexer
 * is unavailable instead of showing zeroes.
 */
export async function indexed<T>(fn: (db: ReturnType<typeof getDb>) => Promise<T>) {
  if (!hasDatabase()) return json({ available: false, reason: "indexer not configured" });
  try {
    return json({ available: true, data: await fn(getDb()) });
  } catch (e) {
    console.error("[api] indexed query failed", e);
    return json({ available: false, reason: "indexer unavailable" }, { status: 200 });
  }
}

export function intParam(v: string | null, def: number, min: number, max: number) {
  if (v === null || v.trim() === "") return def; // Number(null) is 0, not "missing"
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : def;
}

export function isBase58Address(v: string | null): v is string {
  return !!v && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
}
