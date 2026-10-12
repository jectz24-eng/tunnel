import { indexed, isBase58Address, json } from "@/server/http";

export const dynamic = "force-dynamic";

/** A player's public totals (never their balance). */
export async function GET(_req: Request, ctx: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await ctx.params;
  if (!isBase58Address(wallet)) return json({ error: "invalid address" }, { status: 400 });
  return indexed(async (db) => {
    const a = await db.account.findUnique({
      where: { wallet },
      select: { wallet: true, bets: true, particles: true, hits: true, wagered: true, returned: true, biggestWin: true, createdAt: true },
    });
    if (!a) return null;
    const [rank] = await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "Account" WHERE "wagered" > ${a.wagered}`;
    return { ...a, rank: Number(rank?.n ?? 0n) + 1 };
  });
}
