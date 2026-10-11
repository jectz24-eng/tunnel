import type { NextRequest } from "next/server";
import { indexed, intParam } from "@/server/http";
import { recentCycles } from "@/server/queries";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const limit = intParam(q.get("limit"), 20, 1, 200);
  const before = q.get("before");
  return indexed((db) => recentCycles(db, limit, before && /^\d+$/.test(before) ? BigInt(before) : undefined));
}
