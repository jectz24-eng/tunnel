import { indexed } from "@/server/http";
import { empiricalRates } from "@/server/queries";

export const dynamic = "force-dynamic";

/** Observed tunneling frequencies vs the physics model (laboratory "historical records"). */
export function GET() {
  return indexed((db) => empiricalRates(db));
}
