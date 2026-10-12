import type { NextRequest } from "next/server";
import { indexed, intParam } from "@/server/http";

export const dynamic = "force-dynamic";

const ORDER = { wagered: "wagered", biggest: "biggestWin", bets: "bets", hits: "hits" } as const;

/** Player rankings from real account totals. */
export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const key = (q.get("category") ?? "wagered") as keyof typeof ORDER;
  const field = ORDER[key] ?? "wagered";
  const limit = intParam(q.get("limit"), 50, 1, 200);
  return indexed(async (db) => {
    const rows = await db.account.findMany({
      where: { bets: { gt: 0 } },
      orderBy: [{ [field]: "desc" }, { wallet: "asc" }],
      take: limit,
      select: { wallet: true, wagered: true, biggestWin: true, bets: true, particles: true, hits: true },
    });
    return { rows: rows.map((r, i) => ({ rank: i + 1, ...r })), category: key in ORDER ? key : "wagered" };
  });
}
