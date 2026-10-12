import type { NextRequest } from "next/server";
import { indexed, json } from "@/server/http";
import { playerState, sessionWallet } from "@/server/casino";

export const dynamic = "force-dynamic";

/** The signed-in player's balance, seeds, bets, deposits and withdrawals. */
export function GET(req: NextRequest) {
  const wallet = sessionWallet(req);
  if (!wallet) return json({ error: "sign in with your wallet" }, { status: 401 });
  return indexed((db) => playerState(db, wallet));
}
