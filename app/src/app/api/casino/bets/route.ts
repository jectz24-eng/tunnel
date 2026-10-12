import type { NextRequest } from "next/server";
import { indexed, intParam, isBase58Address } from "@/server/http";
import { betDto } from "@/server/casino";

export const dynamic = "force-dynamic";

/** Recent bets (all players or one wallet), or the biggest wins with `big=1`. Public, like a live-bets feed. */
export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const wallet = q.get("wallet");
  const big = q.get("big") === "1";
  const take = intParam(q.get("limit"), 30, 1, 100);
  const page = intParam(q.get("page"), 0, 0, 10_000);
  return indexed(async (db) => {
    const where = { ...(isBase58Address(wallet) ? { wallet } : {}), ...(big ? { wins: { gt: 0 } } : {}) };
    const [rows, total] = await Promise.all([
      db.bet.findMany({ where, orderBy: big ? [{ payout: "desc" }, { id: "desc" }] : { id: "desc" }, take, skip: page * take }),
      db.bet.count({ where }),
    ]);
    return { rows: rows.map(betDto), total, page, pageSize: take };
  });
}
