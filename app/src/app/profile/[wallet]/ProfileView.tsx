"use client";

import { formatTunnel, shortKey } from "@tunnel/sdk";
import { useState } from "react";
import { HistoryView } from "@/app/history/HistoryView";
import { Unavailable, Val } from "@/components/ui";
import { useIndexed } from "@/lib/api";
import { explorerAddress } from "@/lib/config";

interface Player {
  wallet: string;
  bets: number;
  particles: number;
  hits: number;
  wagered: string;
  returned: string;
  biggestWin: string;
  createdAt: string;
  rank: number;
}

/** Public player profile: lifetime totals and every shot. */
export function ProfileView({ wallet }: { wallet: string }) {
  const res = useIndexed<Player | null>(`/api/casino/players/${wallet}`, 10_000);
  const [copied, setCopied] = useState(false);
  const p = res.data?.data;
  const loading = !res.data;
  const none = res.data?.available && !p;

  return (
    <>
      <div className="relative overflow-hidden border-b border-line-soft">
        <div className="grid-backdrop pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative mx-auto max-w-[1400px] px-4 pb-10 pt-14 sm:px-6">
          <div className="eyebrow">Player</div>
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
              view on explorer
            </a>
            {p && <span>playing since {new Date(p.createdAt).toLocaleDateString()}</span>}
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
        {res.data && !res.data.available ? (
          <Unavailable what="This profile" />
        ) : (
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-5">
            {[
              ["Rank", p ? `#${p.rank}` : none ? "—" : null],
              ["Shots", p ? p.bets.toLocaleString() : none ? "0" : null],
              ["Tunnel rate", p ? (p.particles ? `${((p.hits / p.particles) * 100).toFixed(1)}%` : "—") : none ? "—" : null],
              ["$TUNNEL wagered", p ? formatTunnel(BigInt(p.wagered), 0) : none ? "0" : null],
              ["Biggest shot", p ? formatTunnel(BigInt(p.biggestWin)) : none ? "0" : null],
            ].map(([k, v]) => (
              <div key={k} className="bg-panel px-5 py-5">
                <dt className="label">{k}</dt>
                <dd className="mt-2 font-mono text-xl tabular">
                  <Val v={v} loading={loading} />
                </dd>
              </div>
            ))}
          </dl>
        )}
        <div className="mt-8">
          <HistoryView wallet={wallet} />
        </div>
      </div>
    </>
  );
}
