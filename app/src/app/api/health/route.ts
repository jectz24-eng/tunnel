import { getDb, hasDatabase } from "@tunnel/db";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Liveness of the web app, the database and the engine heartbeat. */
export async function GET() {
  if (!hasDatabase()) return json({ ok: false, db: "not-configured" }, { status: 503 });
  try {
    const cfg = await getDb().protocolConfig.findUnique({ where: { id: 1 }, select: { engineHeartbeat: true, lastSlot: true, paused: true } });
    const engineLagMs = cfg?.engineHeartbeat ? Date.now() - cfg.engineHeartbeat.getTime() : null;
    return json({ ok: true, db: "up", engineOnline: engineLagMs != null && engineLagMs < 30_000, engineLagMs, slot: cfg?.lastSlot ?? null, paused: cfg?.paused ?? null });
  } catch (e) {
    console.error("[health]", e);
    return json({ ok: false, db: "down" }, { status: 503 });
  }
}
