import type { NextRequest } from "next/server";
import { indexed, intParam, isBase58Address } from "@/server/http";
import { LEADER_CATEGORIES, leaderboard, type LeaderCategory } from "@/server/queries";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const raw = q.get("category") ?? "tunnels";
  const category = (raw in LEADER_CATEGORIES ? raw : "tunnels") as LeaderCategory;
  const wallet = q.get("wallet");
  return indexed((db) => leaderboard(db, category, intParam(q.get("limit"), 100, 1, 500), isBase58Address(wallet) ? wallet : undefined));
}
