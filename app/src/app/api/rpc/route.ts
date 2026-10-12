import { getDb, hasDatabase } from "@tunnel/db";
import { json } from "@/server/http";
import { publicRpcUrl } from "@/server/settings";

export const dynamic = "force-dynamic";

/** The RPC endpoint browsers should use (set from /admin). */
export async function GET() {
  return json({ rpcUrl: await publicRpcUrl(hasDatabase() ? getDb() : null) });
}
