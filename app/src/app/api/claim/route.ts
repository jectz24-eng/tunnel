import { requestClaim } from "@tunnel/core";
import { getDb, hasDatabase } from "@tunnel/db";
import type { NextRequest } from "next/server";
import { json } from "@/server/http";
import { protocolErrorResponse } from "@/server/protocol";
import { clientIp, rateLimit } from "@/server/ratelimit";

export const dynamic = "force-dynamic";

/** Request a payout of everything the signing wallet can claim. The engine sends it on-chain. */
export async function POST(req: NextRequest) {
  if (!hasDatabase()) return json({ error: "Claims are not available right now." }, { status: 503 });
  const limited = await rateLimit(`claim:ip:${clientIp(req.headers)}`, 10, 60_000);
  if (!limited.allowed) return json({ error: "Too many claim requests. Wait a minute and try again.", code: "rate_limited" }, { status: 429 });
  const body = await req.json().catch(() => null);
  try {
    return json({ ok: true, payout: await requestClaim(getDb(), body as { message: string; signature: string }) });
  } catch (e) {
    return protocolErrorResponse(e);
  }
}
