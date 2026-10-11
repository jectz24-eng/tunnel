import { indexed, isBase58Address, json } from "@/server/http";
import { experimentDetail } from "@/server/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ cycle: string; owner: string; seq: string }> }) {
  const { cycle, owner, seq } = await ctx.params;
  if (!/^\d{1,19}$/.test(cycle) || !isBase58Address(owner) || !/^\d{1,5}$/.test(seq)) return json({ error: "invalid experiment id" }, { status: 400 });
  return indexed((db) => experimentDetail(db, BigInt(cycle), owner, Number(seq)));
}
