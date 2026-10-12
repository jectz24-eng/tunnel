import { requestWithdrawal } from "@tunnel/core";
import { getDb, hasDatabase } from "@tunnel/db";
import type { NextRequest } from "next/server";
import { json } from "@/server/http";
import { protocolErrorResponse } from "@/server/protocol";
import { clientIp, rateLimit } from "@/server/ratelimit";

export const dynamic = "force-dynamic";

/** Withdraw $TUNNEL to the signing wallet. Signed message; the engine sends it on-chain. */
export async function POST(req: NextRequest) {
  if (!hasDatabase()) return json({ error: "Withdrawals are offline." }, { status: 503 });
  const limited = await rateLimit(`withdraw:ip:${clientIp(req.headers)}`, 10, 60_000);
  if (!limited.allowed) return json({ error: "Too many requests. Wait a minute and try again.", code: "rate_limited" }, { status: 429 });
  try {
    return json({ ok: true, withdrawal: await requestWithdrawal(getDb(), await req.json().catch(() => null)) });
  } catch (e) {
    return protocolErrorResponse(e);
  }
}
