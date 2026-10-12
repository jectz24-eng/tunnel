import "server-only";
import { scryptSync, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, readAdminSession } from "./session";

/** Actor recorded in the audit log for changes made from /admin. */
export const ADMIN_ACTOR = "admin";

/**
 * Checks a password against ADMIN_PASSWORD_HASH, formatted `scrypt:<N>:<salt b64>:<hash b64>`
 * (`npm run admin:password-hash -- <password>` prints one; no `$`, which .env files would expand).
 * Returns null when no hash is configured.
 */
export function checkAdminPassword(password: string): boolean | null {
  const [kind, n, salt, hash] = (process.env.ADMIN_PASSWORD_HASH ?? "").split(":");
  if (kind !== "scrypt" || !n || !salt || !hash) return null;
  const want = Buffer.from(hash, "base64");
  const got = scryptSync(password, Buffer.from(salt, "base64"), want.length, { N: Number(n), maxmem: 256 * 1024 * 1024 });
  return timingSafeEqual(got, want);
}

/** Admin authorization: an HttpOnly session cookie issued only after the admin password was verified. */
export function requireAdmin(req: NextRequest): { ok: true; wallet: string } | { ok: false; status: number; error: string } {
  if (!readAdminSession(req.cookies.get(ADMIN_COOKIE)?.value)) return { ok: false, status: 401, error: "admin password required" };
  return { ok: true, wallet: ADMIN_ACTOR };
}
