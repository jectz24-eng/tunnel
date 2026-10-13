"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { formatTunnel, shortKey } from "@tunnel/sdk";
import Link from "next/link";
import { SolscanLink } from "@/components/SolscanLink";
import { useState } from "react";
import { Empty, Panel, Unavailable, cx } from "@/components/ui";
import { useIndexed } from "@/lib/api";

interface Row {
  rank: number;
  wallet: string;
  wagered: string;
  biggestWin: string;
  bets: number;
  particles: number;
  hits: number;
}

const CATEGORIES = [
  { key: "wagered", label: "Biggest players", value: (r: Row) => formatTunnel(BigInt(r.wagered), 0), unit: "$TUNNEL wagered" },
  { key: "biggest", label: "Biggest single shot", value: (r: Row) => formatTunnel(BigInt(r.biggestWin)), unit: "$TUNNEL" },
  { key: "hits", label: "Most tunnels", value: (r: Row) => r.hits.toLocaleString(), unit: "particles" },
  { key: "bets", label: "Most shots", value: (r: Row) => r.bets.toLocaleString(), unit: "shots" },
] as const;

/** Rankings from real account totals. */
export function LeaderboardView() {
  const { publicKey } = useWallet();
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]["key"]>("wagered");
  const c = CATEGORIES.find((x) => x.key === cat)!;
  const res = useIndexed<{ rows: Row[] }>(`/api/casino/leaderboard?category=${cat}&limit=100`, 15_000);
  const rows = res.data?.data?.rows ?? [];
  const podium = rows.slice(0, 3);
  const me = publicKey?.toBase58();

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-panel p-1" role="tablist" aria-label="Leaderboard category">
        {CATEGORIES.map((x) => (
          <button
            key={x.key}
            role="tab"
            aria-selected={cat === x.key}
            onClick={() => setCat(x.key)}
            className={cx("whitespace-nowrap rounded-lg px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors", cat === x.key ? "bg-panel-2 text-fg shadow-[inset_0_-1px_0_#00D9FF]" : "text-muted hover:text-fg")}
          >
            {x.label}
          </button>
        ))}
      </div>

      {res.data && !res.data.available ? (
        <div className="mt-6">
          <Unavailable what="The leaderboard" />
        </div>
      ) : rows.length === 0 ? (
        <Panel className="mt-6">
          <Empty title={res.loading ? "Loading…" : "The board is wide open"}>Fire your first shot to claim a spot.</Empty>
        </Panel>
      ) : (
        <>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {podium.map((r, i) => (
              <Panel key={r.wallet} brackets className="p-6">
                <div className="font-mono text-[11px] tracking-[0.2em]" style={{ color: ["#EAFBFF", "#00D9FF", "#885BFF"][i] }}>
                  #{r.rank}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Link href={`/profile/${r.wallet}`} className="font-mono text-lg hover:text-cyan">
                    {shortKey(r.wallet, 6)}
                  </Link>
                  <SolscanLink address={r.wallet} />
                </div>
                <div className="mt-4 font-mono text-[28px] tabular">{c.value(r)}</div>
                <div className="text-[11px] text-faint">{c.unit}</div>
              </Panel>
            ))}
          </div>
          <Panel className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line-soft text-left">
                  {["Rank", "Player", c.label, "Shots", "Tunnel rate"].map((h) => (
                    <th key={h} className="label px-5 py-3 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.wallet} className={cx("border-b border-line-soft last:border-0", r.wallet === me && "bg-cyan/[0.05]")}>
                    <td className="px-5 py-3 font-mono text-xs text-muted">#{r.rank}</td>
                    <td className="px-5 py-3 font-mono text-xs">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <Link href={`/profile/${r.wallet}`} className="hover:text-cyan">
                          {shortKey(r.wallet, 6)}
                        </Link>
                        {r.wallet === me && <span className="text-cyan">you</span>}
                        <SolscanLink address={r.wallet} />
                      </div>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs tabular">{c.value(r)}</td>
                    <td className="px-5 py-3 font-mono text-xs tabular">{r.bets.toLocaleString()}</td>
                    <td className="px-5 py-3 font-mono text-xs tabular">{r.particles ? `${((r.hits / r.particles) * 100).toFixed(1)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  );
}
