import { rotateSeed } from "@tunnel/core";
import { getDb, hasDatabase } from "@tunnel/db";
import type { NextRequest } from "next/server";
import { json } from "@/server/http";
import { protocolErrorResponse } from "@/server/protocol";
import { crossOrigin, sessionWallet } from "@/server/casino";

export const dynamic = "force-dynamic";

/** Reveal the current server seed and start a new pair (optionally with your own client seed). */
export async function POST(req: NextRequest) {
  if (!hasDatabase()) return json({ error: "Offline." }, { status: 503 });
  const wallet = sessionWallet(req);
  if (!wallet) return json({ error: "Sign in with your wallet first.", code: "unauthorized" }, { status: 401 });
  if (crossOrigin(req)) return json({ error: "cross-origin request refused" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { clientSeed?: unknown };
  try {
    return json({ ok: true, ...(await rotateSeed(getDb(), wallet, typeof body.clientSeed === "string" && body.clientSeed ? body.clientSeed : undefined)) });
  } catch (e) {
    return protocolErrorResponse(e);
  }
}
