import "server-only";
import { NextResponse } from "next/server";
import { getDb, hasDatabase } from "@tunnel/db";

/**
 * The origin the browser sees. Behind a proxy (Render) `req.nextUrl.origin` is the
 * internal address, so prefer the forwarded host/proto headers the proxy sets.
 */
export function publicOrigin(req: { headers: Headers; nextUrl: URL }): string {
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host");
  if (!host) return req.nextUrl.origin;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** True for a request whose Origin header names another site (absent Origin is allowed). */
export function crossOrigin(req: { headers: Headers; nextUrl: URL }): boolean {
  const origin = req.headers.get("origin");
  return !!origin && origin !== publicOrigin(req);
}

/** JSON response that serialises bigint as decimal strings. */
export function json(data: unknown, init?: ResponseInit) {
  return new NextResponse(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    ...init,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

/**
 * Runs a database query. When no database is configured or it is
 * unreachable, responds `{ available: false }` — the UI then says the service
 * is unavailable instead of showing zeroes.
 */
export async function indexed<T>(fn: (db: ReturnType<typeof getDb>) => Promise<T>) {
  if (!hasDatabase()) return json({ available: false, reason: "database not configured" });
  try {
    return json({ available: true, data: await fn(getDb()) });
  } catch (e) {
    console.error("[api] indexed query failed", e);
    return json({ available: false, reason: "database unavailable" }, { status: 200 });
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
