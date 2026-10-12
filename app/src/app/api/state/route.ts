import { indexed } from "@/server/http";
import { liveState } from "@/server/queries";

export const dynamic = "force-dynamic";

/** Live protocol state: configuration, open cycle, recent cycles and server time. */
export function GET() {
  return indexed((db) => liveState(db, 12));
}
