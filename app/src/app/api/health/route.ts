import { getDb, hasDatabase } from "@tunnel/db";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Liveness + indexer freshness for monitoring. */
export async function GET() {
  if (!hasDatabase()) return json({ ok: true, db: "not-configured" });
  try {
    const db = getDb();
    const state = await db.protocolState.findUnique({ where: { id: 1 }, select: { updatedAt: true, slot: true } });
    const lagMs = state ? Date.now() - state.updatedAt.getTime() : null;
    const healthy = lagMs != null && lagMs < 60_000;
    return json({ ok: healthy, db: "up", indexerLagMs: lagMs, slot: state?.slot ?? null }, { status: healthy || !state ? 200 : 503 });
  } catch (e) {
    return json({ ok: false, db: "down", error: String(e) }, { status: 503 });
  }
}
