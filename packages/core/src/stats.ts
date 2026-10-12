import type { Tx } from "./config";

/** Recomputes a wallet's aggregates from its Position rows (never incremented blindly). */
export async function recomputeWalletStats(db: Tx, wallet: string): Promise<void> {
  const positions = await db.position.findMany({
    where: { wallet },
    orderBy: { cycleId: "asc" },
    select: { cycleId: true, particles: true, successes: true, energyUsed: true, experiments: true, settled: true, payout: true, payoutId: true },
  });
  if (positions.length === 0) return;
  const confirmed = new Set(
    (await db.payout.findMany({ where: { wallet, status: "confirmed" }, select: { id: true } })).map((p) => p.id.toString()),
  );

  let particles = 0n, successes = 0n, settledParticles = 0n, energy = 0n, earned = 0n, claimed = 0n, best = 0n;
  let experiments = 0, claimable = 0, longest = 0, run = 0;
  let prev: bigint | null = null;
  for (const p of positions) {
    const n = BigInt(p.particles.reduce((a, b) => a + b, 0));
    particles += n;
    energy += BigInt(p.energyUsed);
    experiments += p.experiments;
    if (p.settled) {
      settledParticles += n;
      successes += BigInt(p.successes.reduce((a, b) => a + b, 0));
      const pay = p.payout ?? 0n;
      earned += pay;
      if (pay > best) best = pay;
      if (p.payoutId != null && confirmed.has(p.payoutId.toString())) claimed += pay;
      if (pay > 0n && p.payoutId == null) claimable++;
    }
    run = prev != null && p.cycleId === prev + 1n ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = p.cycleId;
  }
  const latest = await db.cycle.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
  // The current streak survives while the wallet played the latest or the previous cycle.
  const current = prev != null && latest && latest.id - prev <= 1n ? run : 0;

  const data = {
    cyclesPlayed: positions.length,
    experiments,
    particles,
    successes,
    failures: settledParticles - successes,
    energyUsed: energy,
    tokensEarned: earned,
    tokensClaimed: claimed,
    bestCycleTokens: best,
    longestStreak: longest,
    currentStreak: current,
    claimableCycles: claimable,
  };
  await db.walletStats.upsert({ where: { owner: wallet }, create: { owner: wallet, ...data }, update: data });
}
