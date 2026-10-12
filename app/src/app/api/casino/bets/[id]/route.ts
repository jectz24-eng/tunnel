import { publicSeedPair } from "@tunnel/core";
import { indexed, json } from "@/server/http";
import { betDto } from "@/server/casino";

export const dynamic = "force-dynamic";

/** One bet with its seed pair; the server seed is included once the player has rotated it. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d{1,19}$/.test(id)) return json({ error: "invalid bet id" }, { status: 400 });
  return indexed(async (db) => {
    const bet = await db.bet.findUnique({ where: { id: BigInt(id) } });
    if (!bet) return null;
    const seed = await db.seedPair.findUnique({ where: { id: bet.seedPairId } });
    return { bet: betDto(bet), seed: seed ? publicSeedPair(seed) : null };
  });
}
