import "server-only";
import type { NextRequest } from "next/server";
import { serverProtocol } from "./chain";
import { SESSION_COOKIE, readSession } from "./session";

/**
 * Admin authorization for the operations console. The signed-in wallet
 * (Sign-In With Solana session) must be the protocol admin recorded onchain.
 * This gates *viewing* operational data only: every admin action is an
 * onchain instruction that the program itself authorizes against the same key.
 */
export async function requireAdmin(req: NextRequest): Promise<{ ok: true; wallet: string } | { ok: false; status: number; error: string }> {
  const wallet = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!wallet) return { ok: false, status: 401, error: "sign in with the admin wallet" };
  let admin: string | null = null;
  try {
    admin = (await serverProtocol())?.admin.toBase58() ?? null;
  } catch {
    return { ok: false, status: 503, error: "cannot read the protocol admin from chain" };
  }
  if (!admin) return { ok: false, status: 404, error: "protocol not initialized" };
  if (admin !== wallet) return { ok: false, status: 403, error: "this wallet is not the protocol admin" };
  return { ok: true, wallet };
}
