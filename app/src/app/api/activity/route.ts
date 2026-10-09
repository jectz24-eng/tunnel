import type { NextRequest } from "next/server";
import { indexed, intParam } from "@/server/http";
import { activity } from "@/server/queries";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const limit = intParam(req.nextUrl.searchParams.get("limit"), 30, 1, 200);
  return indexed((db) => activity(db, limit));
}
