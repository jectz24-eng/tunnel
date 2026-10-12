import { loadConfig, setBetLimits, setParams, setPaused } from "@tunnel/core";
import { getDb } from "@tunnel/db";
import { TUNNEL_UNIT } from "@tunnel/sdk";
import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/admin";
import { indexed, json } from "@/server/http";
import { protocolErrorResponse } from "@/server/protocol";
import { adminOverview } from "@/server/queries";

export const dynamic = "force-dynamic";

/** Operations overview (admin session required). */
export async function GET(req: NextRequest) {
  const auth = requireAdmin(req);
  if (!auth.ok) return json({ error: auth.error }, { status: auth.status });
  return indexed((db) => adminOverview(db));
}

type Action =
  | { action: "pause" }
  | { action: "resume" }
  | { action: "cycleDuration"; seconds: number }
  | { action: "emission"; tokensPerCycle: string }
  | { action: "energy"; perCycle: number }
  | { action: "betting"; open: boolean }
  | { action: "betLimits"; minBet: string; maxBet: string; maxWinBps: number };

/** Admin actions. Every change is written to the ProtocolEvent audit log with the admin wallet. */
export async function POST(req: NextRequest) {
  const auth = requireAdmin(req);
  if (!auth.ok) return json({ error: auth.error }, { status: auth.status });
  // Same-origin only: the session cookie is SameSite=Strict, this is defence in depth.
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return json({ error: "cross-origin request refused" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as Action | null;
  const db = getDb();
  try {
    switch (body?.action) {
      case "pause":
      case "resume":
        await setPaused(db, body.action === "pause", auth.wallet);
        break;
      case "cycleDuration": {
        const c = await loadConfig(db);
        await setParams(db, { ...c.params, cycleDurationSecs: Math.floor(Number(body.seconds)) }, auth.wallet);
        break;
      }
      case "emission": {
        if (!/^\d{1,12}$/.test(String(body.tokensPerCycle))) return json({ error: "whole $TUNNEL per cycle" }, { status: 400 });
        const c = await loadConfig(db);
        await setParams(db, { ...c.params, initialEmissionPerCycle: BigInt(body.tokensPerCycle) * TUNNEL_UNIT }, auth.wallet);
        break;
      }
      case "energy": {
        const c = await loadConfig(db);
        await setParams(db, { ...c.params, energyPerCycle: Math.floor(Number(body.perCycle)) }, auth.wallet);
        break;
      }
      case "betting":
        await setBetLimits(db, { bettingPaused: !body.open }, auth.wallet);
        break;
      case "betLimits": {
        if (!/^d{1,12}$/.test(String(body.minBet)) || !/^d{1,12}$/.test(String(body.maxBet))) return json({ error: "whole $TUNNEL amounts" }, { status: 400 });
        await setBetLimits(db, { minBet: BigInt(body.minBet) * TUNNEL_UNIT, maxBet: BigInt(body.maxBet) * TUNNEL_UNIT, maxWinBps: Math.floor(Number(body.maxWinBps)) }, auth.wallet);
        break;
      }
      default:
        return json({ error: "unknown action" }, { status: 400 });
    }
    return json({ ok: true });
  } catch (e) {
    return protocolErrorResponse(e);
  }
}
