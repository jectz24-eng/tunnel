import type { NextRequest } from "next/server";
import { indexed, intParam } from "@/server/http";
import { recentRounds } from "@/server/queries";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const limit = intParam(req.nextUrl.searchParams.get("limit"), 20, 1, 200);
  const beforeRaw = req.nextUrl.searchParams.get("before");
  const before = beforeRaw && /^\d+$/.test(beforeRaw) ? BigInt(beforeRaw) : undefined;
  return indexed((db) => recentRounds(db, limit, before));
}
