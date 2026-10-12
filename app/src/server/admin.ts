import "server-only";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, readSession } from "./session";

/** Wallets allowed to operate TUNNEL, from ADMIN_WALLETS (comma-separated public addresses). */
export function adminWallets(): Set<string> {
  return new Set((process.env.ADMIN_WALLETS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

/**
 * Admin authorization: the Sign-In With Solana session (an HttpOnly cookie
 * issued only after verifying a wallet signature) must belong to a wallet
 * listed in ADMIN_WALLETS.
 */
export function requireAdmin(req: NextRequest): { ok: true; wallet: string } | { ok: false; status: number; error: string } {
  const wallet = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!wallet) return { ok: false, status: 401, error: "sign in with an admin wallet" };
  if (adminWallets().size === 0) return { ok: false, status: 503, error: "ADMIN_WALLETS is not configured" };
  if (!adminWallets().has(wallet)) return { ok: false, status: 403, error: "this wallet is not an admin" };
  return { ok: true, wallet };
}
