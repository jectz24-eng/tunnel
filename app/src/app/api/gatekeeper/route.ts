import { PublicKey, Transaction } from "@solana/web3.js";
import { isGatekeeperEnabled } from "@tunnel/sdk";
import type { NextRequest } from "next/server";
import { gatekeeperKeypair, serverProgramId, serverProtocol } from "@/server/chain";
import { checkDeployTransaction } from "@/server/gatekeeper";
import { json } from "@/server/http";
import { clientIp, rateLimit } from "@/server/ratelimit";
import { SESSION_COOKIE, readSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOUR = 3_600_000;
const WALLET_LIMIT = Number(process.env.GATEKEEPER_WALLET_LIMIT_PER_HOUR ?? 60);
const IP_LIMIT = Number(process.env.GATEKEEPER_IP_LIMIT_PER_HOUR ?? 120);
const GLOBAL_LIMIT = Number(process.env.GATEKEEPER_GLOBAL_LIMIT_PER_MINUTE ?? 600);

/** Whether deployments currently require the co-signature, and whether this server can provide it. */
export async function GET() {
  const protocol = await serverProtocol().catch(() => null);
  const key = gatekeeperKeypair();
  const required = !!protocol && isGatekeeperEnabled(protocol);
  return json({ required, gatekeeper: required ? protocol!.gatekeeper.toBase58() : null, available: required && !!key && key.publicKey.equals(protocol!.gatekeeper) });
}

/**
 * Co-signs a deployment after abuse checks: signed-in wallet (Sign-In With
 * Solana), per-wallet / per-IP / global rate limits, and a strict shape check
 * of the transaction. This is a configurable mitigation, not Sybil resistance:
 * one person can still control many wallets.
 */
export async function POST(req: NextRequest) {
  const wallet = readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!wallet) return json({ error: "Verify wallet ownership (sign-in message) before deploying." }, { status: 401 });

  const key = gatekeeperKeypair();
  const protocol = await serverProtocol().catch(() => null);
  if (!protocol || !isGatekeeperEnabled(protocol)) return json({ error: "co-signing is not required" }, { status: 409 });
  if (!key || !key.publicKey.equals(protocol.gatekeeper)) return json({ error: "this server is not the configured gatekeeper" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { transaction?: string } | null;
  if (!body?.transaction || body.transaction.length > 4_000) return json({ error: "malformed request" }, { status: 400 });
  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(body.transaction, "base64"));
  } catch {
    return json({ error: "malformed transaction" }, { status: 400 });
  }
  const check = checkDeployTransaction(tx, new PublicKey(wallet), key.publicKey, serverProgramId());
  if (!check.ok) return json({ error: check.error }, { status: 400 });

  for (const [scope, k, limit, windowMs] of [
    ["wallet", `gk:w:${wallet}`, WALLET_LIMIT, HOUR],
    ["network", `gk:ip:${clientIp(req.headers)}`, IP_LIMIT, HOUR],
    ["global", "gk:global", GLOBAL_LIMIT, 60_000],
  ] as const) {
    const r = await rateLimit(k, limit, windowMs);
    if (!r.allowed) {
      return json(
        { error: `Rate limit reached (${scope}). Try again after ${r.resetAt.toISOString().slice(11, 19)} UTC.` },
        { status: 429, headers: { "retry-after": String(Math.ceil((r.resetAt.getTime() - Date.now()) / 1000)) } },
      );
    }
  }

  tx.partialSign(key);
  return json({ transaction: tx.serialize({ requireAllSignatures: false }).toString("base64") });
}
