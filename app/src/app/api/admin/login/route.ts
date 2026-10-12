import type { NextRequest } from "next/server";
import { checkAdminPassword } from "@/server/admin";
import { json } from "@/server/http";
import { clientIp, rateLimit } from "@/server/ratelimit";
import { ADMIN_COOKIE, issueAdminSession } from "@/server/session";

export const dynamic = "force-dynamic";

const cookie = { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/" } as const;

/** Password sign-in for /admin. Rate limited per IP and globally against guessing. */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return json({ error: "cross-origin request refused" }, { status: 403 });
  const [ip, all] = await Promise.all([rateLimit(`admin-login:ip:${clientIp(req.headers)}`, 5, 15 * 60_000), rateLimit("admin-login:all", 30, 15 * 60_000)]);
  if (!ip.allowed || !all.allowed) return json({ error: "too many attempts, try again in 15 minutes" }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
  const ok = typeof body?.password === "string" && body.password.length <= 200 ? checkAdminPassword(body.password) : false;
  if (ok === null) return json({ error: "ADMIN_PASSWORD_HASH is not configured" }, { status: 503 });
  if (!ok) return json({ error: "wrong password" }, { status: 401 });
  const session = issueAdminSession();
  const res = json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, session.value, { ...cookie, maxAge: session.maxAge });
  return res;
}

export async function DELETE() {
  const res = json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { ...cookie, maxAge: 0 });
  return res;
}
