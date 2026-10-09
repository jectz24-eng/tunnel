import { indexed, json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Indexed settlement records for a round (covers positions already closed by claiming). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d{1,20}$/.test(id)) return json({ error: "invalid round id" }, { status: 400 });
  const roundId = BigInt(id);
  return indexed(async (db) => {
    const [settled, claims, round] = await Promise.all([
      db.indexedEvent.findMany({ where: { roundId, name: "PositionSettled" }, orderBy: { id: "asc" } }),
      db.claim.findMany({ where: { roundId } }),
      db.round.findUnique({ where: { id: roundId } }),
    ]);
    return {
      round,
      settled: settled.map((e) => ({ signature: e.signature, ...(e.data as Record<string, unknown>) })),
      claims,
    };
  });
}
