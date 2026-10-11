import type { NextRequest } from "next/server";
import { requireAdmin } from "@/server/admin";
import { indexed, json } from "@/server/http";
import { adminOverview } from "@/server/queries";

export const dynamic = "force-dynamic";

/** Operations overview for the protocol admin (Sign-In With Solana session must be the onchain admin). */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return json({ error: auth.error }, { status: auth.status });
  return indexed((db) => adminOverview(db));
}
