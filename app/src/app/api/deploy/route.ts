import { deploy } from "@tunnel/core";
import { getDb, hasDatabase } from "@tunnel/db";
import type { NextRequest } from "next/server";
import { json } from "@/server/http";
import { protocolErrorResponse } from "@/server/protocol";
import { clientIp, rateLimit } from "@/server/ratelimit";

export const dynamic = "force-dynamic";

/**
 * Deploy particles with a signed message (free; no transaction). The
 * signature, freshness, nonce, cycle window and energy allowance are all
 * checked server-side in one locked database transaction.
 */
export async function POST(req: NextRequest) {
  if (!hasDatabase()) return json({ error: "Mining is not available right now." }, { status: 503 });
  const ip = clientIp(req.headers);
  const byIp = await rateLimit(`deploy:ip:${ip}`, 60, 60_000);
  if (!byIp.allowed) return json({ error: "Too many deployments from this network. Wait a minute and try again.", code: "rate_limited" }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { message?: unknown; signature?: unknown } | null;
  const wallet = typeof body?.message === "string" ? /^Wallet: (\S+)$/m.exec(body.message)?.[1] : undefined;
  if (wallet) {
    const byWallet = await rateLimit(`deploy:wallet:${wallet}`, 30, 60_000);
    if (!byWallet.allowed) return json({ error: "Too many deployments from this wallet. Wait a minute and try again.", code: "rate_limited" }, { status: 429 });
  }
  try {
    return json({ ok: true, deployment: await deploy(getDb(), body as { message: string; signature: string }) });
  } catch (e) {
    return protocolErrorResponse(e);
  }
}
