"use client";

import { formatTunnel, shortKey } from "@tunnel/sdk";
import Link from "next/link";
import { useState } from "react";
import { HistoryView } from "@/app/history/HistoryView";
import { Badge, Empty, Panel, PanelHeader, Unavailable } from "@/components/ui";
import { useIndexed } from "@/lib/api";
import { explorerAddress, explorerTx } from "@/lib/config";

interface Profile {
  user: { firstSeenAt: string; lastActivityAt: string } | null;
  stats: {
    cyclesPlayed: number;
    experiments: number;
    particles: string;
    successes: string;
    failures: string;
    energyUsed: string;
    tokensEarned: string;
    tokensClaimed: string;
    bestCycleTokens: string;
    longestStreak: number;
    currentStreak: number;
    claimableCycles: number;
  } | null;
  timeline: { cycleId: string; openTs: string; status: string; outcome: string; particles: number; successes: number; energyUsed: number; experiments: number; settled: boolean; claimed: boolean; tokens: string | null; claimSignature: string | null }[];
}

/** Public wallet profile: aggregates, participation timeline and every experiment. */
export function ProfileView({ wallet }: { wallet: string }) {
  const res = useIndexed<Profile>(`/api/wallet/${wallet}`, 15_000);
  const [copied, setCopied] = useState(false);
  const p = res.data?.data;
  const s = p?.stats;
  const n = s ? BigInt(s.successes) + BigInt(s.failures) : 0n;
  const rate = s && n > 0n ? `${(Number((BigInt(s.successes) * 10_000n) / n) / 100).toFixed(2)}%` : "—";
  const maxP = Math.max(1, ...(p?.timeline ?? []).map((t) => t.particles));

  return (
    <>
      <div className="relative overflow-hidden border-b border-line-soft">
        <div className="grid-backdrop pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative mx-auto max-w-[1400px] px-4 pb-10 pt-14 sm:px-6">
          <div className="eyebrow">Wallet profile</div>
          <h1 className="mt-4 break-all font-mono text-[22px] sm:text-[30px]">{shortKey(wallet, 10)}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted">
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(wallet);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="hover:text-cyan"
            >
              {copied ? "copied" : "copy address"}
            </button>
            <a href={explorerAddress(wallet)} target="_blank" rel="noreferrer" className="hover:text-cyan">
              explorer ↗
            </a>
            {p?.user && <span>first seen {new Date(p.user.firstSeenAt).toLocaleDateString()}</span>}
            {p?.user && <span>last active {new Date(p.user.lastActivityAt).toLocaleString()}</span>}
          </div>
        </div>
      </div>
      <div className="mx-auto grid max-w-[1400px] gap-5 px-4 py-10 sm:px-6">
        {res.data && !res.data.available ? (
          <Unavailable what="Wallet history" />
        ) : !p ? (
          <Empty title="Loading profile…" />
        ) : !s ? (
          <Empty title="No experiments yet">This wallet has not deployed particles, or its experiments are not indexed yet.</Empty>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4 lg:grid-cols-8">
              {[
                ["Attempts", s.experiments.toLocaleString()],
                ["Particles", BigInt(s.particles).toLocaleString()],
                ["Tunnels", BigInt(s.successes).toLocaleString()],
                ["Success rate", rate],
                ["Rewards", formatTunnel(BigInt(s.tokensEarned))],
                ["Claimed", formatTunnel(BigInt(s.tokensClaimed))],
                ["Best cycle", formatTunnel(BigInt(s.bestCycleTokens))],
                ["Streak · best", `${s.currentStreak} · ${s.longestStreak}`],
              ].map(([k, v]) => (
                <div key={k} className="bg-panel px-4 py-4">
                  <dt className="label">{k}</dt>
                  <dd className="mt-1.5 font-mono text-[17px] tabular">{v}</dd>
                </div>
              ))}
            </dl>

            <Panel className="overflow-hidden">
              <PanelHeader title="Participation timeline" right={<span className="font-mono text-[10.5px] text-faint">{s.cyclesPlayed} cycles</span>} />
              <div className="flex h-36 items-end gap-1 overflow-x-auto px-5 pb-3 pt-5">
                {p.timeline
                  .slice()
                  .reverse()
                  .map((t) => (
                    <Link key={t.cycleId} href={`/history/cycle/${t.cycleId}`} className="group flex w-4 shrink-0 flex-col justify-end" title={`Cycle ${t.cycleId}: ${t.successes}/${t.particles} tunneled`}>
                      <div className="rounded-t-sm bg-flare/80 shadow-[0_0_8px_#00D9FF]" style={{ height: `${(t.successes / maxP) * 100}px` }} />
                      <div className="rounded-b-sm bg-amber/30 group-hover:bg-amber/50" style={{ height: `${((t.particles - t.successes) / maxP) * 100}px` }} />
                    </Link>
                  ))}
              </div>
              <div className="flex gap-4 border-t border-line-soft px-5 py-2 font-mono text-[10.5px] text-muted">
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-flare" /> tunneled</span>
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-amber/40" /> reflected</span>
              </div>
            </Panel>

            <Panel className="overflow-hidden">
              <PanelHeader title="Cycles" />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-sm">
                  <thead>
                    <tr className="border-b border-line-soft text-left">
                      {["Cycle", "Time", "Attempts", "Particles", "Tunneled", "Reward", "Status"].map((h) => (
                        <th key={h} className="label px-5 py-2.5 font-normal">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {p.timeline.map((t) => (
                      <tr key={t.cycleId} className="border-b border-line-soft last:border-0">
                        <td className="px-5 py-2.5 font-mono text-xs"><Link className="text-fg-2 hover:text-cyan" href={`/history/cycle/${t.cycleId}`}>#{t.cycleId}</Link></td>
                        <td className="px-5 py-2.5 font-mono text-xs text-muted">{new Date(t.openTs).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                        <td className="px-5 py-2.5 font-mono text-xs">{t.experiments}</td>
                        <td className="px-5 py-2.5 font-mono text-xs">{t.particles}</td>
                        <td className="px-5 py-2.5 font-mono text-xs">{t.settled ? t.successes : "—"}</td>
                        <td className="px-5 py-2.5 font-mono text-xs">{t.tokens != null ? formatTunnel(BigInt(t.tokens)) : "—"}</td>
                        <td className="px-5 py-2.5">
                          {t.claimed ? (
                            t.claimSignature ? <a href={explorerTx(t.claimSignature)} target="_blank" rel="noreferrer"><Badge tone="ion">claimed ↗</Badge></a> : <Badge tone="ion">claimed</Badge>
                          ) : (
                            <Badge tone={t.status === "settled" ? "flare" : t.status === "void" ? "red" : "neutral"}>{t.status}</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </>
        )}
        <div>
          <div className="label mb-3">Experiments</div>
          <HistoryView owner={wallet} />
        </div>
      </div>
    </>
  );
}
