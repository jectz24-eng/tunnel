import type { NextRequest } from "next/server";
import { indexed, intParam } from "@/server/http";
import { leaderboard, type LeaderSort } from "@/server/queries";

export const dynamic = "force-dynamic";

const SORTS: LeaderSort[] = ["tokens", "successes", "particles", "rate", "sol"];
const PERIODS: Record<string, number | null> = { all: null, "30d": 30, "7d": 7, "24h": 1 };

export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const sort = (SORTS.includes(q.get("sort") as LeaderSort) ? q.get("sort") : "tokens") as LeaderSort;
  const days = PERIODS[q.get("period") ?? "all"] ?? null;
  const barrierRaw = q.get("barrier");
  const barrier = barrierRaw && /^[0-2]$/.test(barrierRaw) ? Number(barrierRaw) : undefined;
  const limit = intParam(q.get("limit"), 100, 1, 500);
  return indexed(async (db) => {
    const all = await leaderboard(db, { sort, since: days ? new Date(Date.now() - days * 86_400_000) : undefined, barrier, limit });
    const wallet = q.get("wallet");
    return { rows: all.slice(0, limit), total: all.length, you: wallet ? (all.find((r) => r.owner === wallet) ?? null) : null };
  });
}
