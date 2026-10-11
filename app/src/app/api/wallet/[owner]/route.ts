import { indexed, isBase58Address, json } from "@/server/http";
import { walletProfile } from "@/server/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ owner: string }> }) {
  const { owner } = await ctx.params;
  if (!isBase58Address(owner)) return json({ error: "invalid address" }, { status: 400 });
  return indexed((db) => walletProfile(db, owner));
}
