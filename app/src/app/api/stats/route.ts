import type { NextRequest } from "next/server";
import { indexed, intParam } from "@/server/http";
import { protocolSummary, roundSeries } from "@/server/queries";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const limit = intParam(req.nextUrl.searchParams.get("rounds"), 120, 1, 1000);
  return indexed(async (db) => ({ summary: await protocolSummary(db), series: await roundSeries(db, limit) }));
}
