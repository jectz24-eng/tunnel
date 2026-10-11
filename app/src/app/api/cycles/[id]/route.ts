import { indexed, json } from "@/server/http";
import { cycleDetail } from "@/server/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d{1,19}$/.test(id)) return json({ error: "invalid cycle id" }, { status: 400 });
  return indexed((db) => cycleDetail(db, BigInt(id)));
}
