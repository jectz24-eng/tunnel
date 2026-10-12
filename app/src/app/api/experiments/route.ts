import type { NextRequest } from "next/server";
import { indexed, intParam, isBase58Address } from "@/server/http";
import { experiments } from "@/server/queries";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["pending", "settled", "void", "claimed"]);

/** Global experiment archive: search, filters and pagination over indexed attempts. */
export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const owner = q.get("owner");
  const cycle = q.get("cycle");
  const barrier = q.get("barrier");
  const outcome = q.get("outcome");
  const status = q.get("status");
  const search = q.get("q")?.trim().slice(0, 100) || undefined;
  return indexed((db) =>
    experiments(db, {
      owner: isBase58Address(owner) ? owner : undefined,
      cycleId: cycle && /^\d{1,19}$/.test(cycle) ? BigInt(cycle) : undefined,
      barrier: barrier && /^[0-2]$/.test(barrier) ? Number(barrier) : undefined,
      status: status && STATUSES.has(status) ? status : undefined,
      outcome: outcome === "tunneled" || outcome === "reflected" ? outcome : undefined,
      q: search,
      page: intParam(q.get("page"), 0, 0, 10_000),
      pageSize: intParam(q.get("pageSize"), 25, 1, 100),
    }),
  );
}
