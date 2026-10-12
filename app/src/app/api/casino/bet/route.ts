import { placeBet } from "@tunnel/core";
import { getDb, hasDatabase } from "@tunnel/db";
import type { NextRequest } from "next/server";
import { json } from "@/server/http";
import { protocolErrorResponse } from "@/server/protocol";
import { rateLimit } from "@/server/ratelimit";
import { betDto, crossOrigin, sessionWallet } from "@/server/casino";

export const dynamic = "force-dynamic";

/** Fire particles. Authenticated by the wallet session; resolved instantly. */
export async function POST(req: NextRequest) {
  if (!hasDatabase()) return json({ error: "The accelerator is offline." }, { status: 503 });
  const wallet = sessionWallet(req);
  if (!wallet) return json({ error: "Sign in with your wallet first.", code: "unauthorized" }, { status: 401 });
  if (crossOrigin(req)) return json({ error: "cross-origin request refused" }, { status: 403 });
  const limited = await rateLimit(`bet:${wallet}`, 120, 60_000);
  if (!limited.allowed) return json({ error: "Slow down a little: too many bets this minute.", code: "rate_limited" }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { volatility?: unknown; amount?: unknown; count?: unknown } | null;
  if (!body || typeof body.amount !== "string" || !/^\d{1,20}$/.test(body.amount)) return json({ error: "Invalid bet.", code: "bad_bet" }, { status: 400 });
  try {
    const r = await placeBet(getDb(), wallet, { volatility: Number(body.volatility), amount: BigInt(body.amount), count: Number(body.count) });
    return json({ ok: true, bet: betDto(r.bet), hits: r.hits, balance: r.balance, serverSeedHash: r.serverSeedHash, clientSeed: r.clientSeed });
  } catch (e) {
    return protocolErrorResponse(e);
  }
}
