import { indexed } from "@/server/http";
import { casinoState } from "@/server/casino";

export const dynamic = "force-dynamic";

/** Public accelerator state: limits, deposit address, live totals. */
export function GET() {
  return indexed((db) => casinoState(db));
}
