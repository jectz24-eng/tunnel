"use client";

import { VOLATILITY, formatMultiplier, formatTunnel, shortKey } from "@tunnel/sdk";
import Link from "next/link";
import { getJson } from "@/lib/api";
import { useCasino } from "@/lib/game";
import { usePoll } from "@/lib/poll";
import { Arrow, ButtonLink, Empty, SectionHeading, Unavailable, Val } from "../ui";

/** BY THE NUMBERS — live totals from the accelerator. */
export function AcceleratorStats() {
  const c = useCasino();
  const t = c.data?.totals;
  const loading = c.data === undefined;
  const hitRate = t && t.particles ? `${((t.hits / t.particles) * 100).toFixed(1)}%` : t ? "—" : null;
  return (
    <section className="relative border-y border-line-soft bg-bg-2/40" aria-labelledby="stats-title">
      <div className="mx-auto grid max-w-[1400px] gap-12 px-4 py-28 sm:px-6 lg:grid-cols-[1fr_1.2fr] lg:items-center">
        <SectionHeading eyebrow="06 / By the numbers" title={<span id="stats-title">The accelerator never sleeps.</span>}>
          Every shot settles the instant it is fired. Winnings land in your balance straight away and withdraw to your wallet as real $TUNNEL whenever you want.
        </SectionHeading>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line">
          {[
            ["Shots fired", t ? t.bets.toLocaleString() : null],
            ["Particles fired", t ? t.particles.toLocaleString() : null],
            ["Tunneled through", t ? `${t.hits.toLocaleString()}` : null],
            ["Tunnel rate", hitRate],
            ["$TUNNEL wagered", t ? formatTunnel(t.wagered, 0) : null],
            ["Biggest single shot", t ? formatTunnel(t.biggestWin, 2) : null],
          ].map(([k, v]) => (
            <div key={k} className="bg-panel p-6">
              <dt className="label">{k}</dt>
              <dd className="mt-2 font-mono text-2xl tabular">
                <Val v={v} loading={loading} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

interface Row {
  id: string;
  wallet: string;
  volatility: number;
  stake: string;
  payout: string;
  wins: number;
  count: number;
  multiplierBps: number;
  createdAt: string;
}

/** BIGGEST HITS — top payouts, each one verifiable. */
export function ArchivePreview() {
  const res = usePoll("home:big", () => getJson<{ rows: Row[] }>("/api/casino/bets?big=1&limit=8"), 15_000);
  const rows = res.data?.data?.rows ?? [];
  return (
    <section className="mx-auto max-w-[1400px] px-4 py-28 sm:px-6" aria-labelledby="archive-title">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeading eyebrow="07 / Biggest hits" title={<span id="archive-title">The shots everyone is talking about.</span>}>
          The largest payouts in the accelerator. Open any of them to see its seeds and replay every particle yourself.
        </SectionHeading>
        <ButtonLink href="/history" variant="secondary">
          Every shot <Arrow />
        </ButtonLink>
      </div>
      <div className="panel mt-10 overflow-x-auto">
        {res.data && !res.data.available ? (
          <div className="p-4">
            <Unavailable what="The shot history" />
          </div>
        ) : rows.length === 0 ? (
          <Empty title={res.loading ? "Loading…" : "No hits yet"}>The first big tunnel lands here.</Empty>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Shot", "Player", "Barrier", "Tunneled", "Bet", "Paid"].map((h) => (
                  <th key={h} className="label px-4 py-3 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const v = VOLATILITY[r.volatility];
                return (
                  <tr key={r.id} className="border-b border-line-soft last:border-0 hover:bg-panel-2/50">
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link href={`/history/bet/${r.id}`} className="text-fg-2 hover:text-cyan">
                        #{r.id}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">
                      <Link href={`/profile/${r.wallet}`} className="hover:text-cyan">
                        {shortKey(r.wallet)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: v.color }}>
                      {v.short} · {formatMultiplier(r.multiplierBps)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {r.wins}/{r.count}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{formatTunnel(BigInt(r.stake))}</td>
                    <td className="px-4 py-3 font-mono text-xs text-flare">{formatTunnel(BigInt(r.payout))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

/** FINAL CTA */
export function FinalCta() {
  return (
    <section className="relative overflow-hidden border-t border-line-soft" aria-labelledby="cta-title">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_80%_at_50%_100%,rgba(0,217,255,0.12),transparent_70%)]" />
      <div className="grid-backdrop absolute inset-0 opacity-40" />
      <div className="relative mx-auto flex max-w-[1400px] flex-col items-center px-4 py-32 text-center sm:px-6 sm:py-40">
        <div className="eyebrow">TUNNEL / QUANTUM EXPERIMENT 001</div>
        <h2 id="cta-title" className="display mt-6 text-[clamp(40px,7vw,96px)]">
          The barrier isn&apos;t
          <br />
          <span className="bg-[linear-gradient(95deg,#EAFBFF,#00D9FF_55%,#885BFF)] bg-clip-text text-transparent">the limit.</span>
        </h2>
        <p className="mt-6 max-w-md text-muted">Pick your barrier. Charge your particles. See what breaks through.</p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/accelerator" variant="energy" size="lg" className="font-mono uppercase">
            Enter the accelerator <Arrow />
          </ButtonLink>
          <ButtonLink href="/laboratory" variant="secondary" size="lg" className="font-mono uppercase">
            Practice free
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
