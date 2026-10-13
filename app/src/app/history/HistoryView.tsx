"use client";

import { VOLATILITY, formatMultiplier, formatTunnel, shortKey } from "@tunnel/sdk";
import Link from "next/link";
import { SolscanLink } from "@/components/SolscanLink";
import { useState } from "react";
import { Hits } from "@/components/game/Panels";
import { Button, Empty, Panel, Unavailable, cx } from "@/components/ui";
import { useIndexed } from "@/lib/api";

export interface ShotRow {
  id: string;
  wallet: string;
  volatility: number;
  amount: string;
  count: number;
  stake: string;
  wins: number;
  payout: string;
  multiplierBps: number;
  winPpb: number;
  outcomeBits: string;
  nonce: number;
  createdAt: string;
}

/** Every shot fired in the accelerator, newest first. */
export function HistoryView({ wallet }: { wallet?: string }) {
  const [big, setBig] = useState(false);
  const [page, setPage] = useState(0);
  const params = new URLSearchParams({ limit: "25", page: String(page) });
  if (wallet) params.set("wallet", wallet);
  if (big) params.set("big", "1");
  const res = useIndexed<{ rows: ShotRow[]; total: number; page: number; pageSize: number }>(`/api/casino/bets?${params}`, 6_000);
  const data = res.data?.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft p-4">
        {[
          [false, "Latest shots"],
          [true, "Biggest hits"],
        ].map(([v, label]) => (
          <button
            key={String(v)}
            onClick={() => {
              setBig(v as boolean);
              setPage(0);
            }}
            className={cx("rounded-lg px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.12em]", big === v ? "bg-panel-2 text-fg shadow-[inset_0_-1px_0_#00D9FF]" : "text-muted hover:text-fg")}
          >
            {label as string}
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] text-faint">{data ? `${data.total.toLocaleString()} shots` : ""}</span>
      </div>
      {res.data && !res.data.available ? (
        <div className="p-4">
          <Unavailable what="Shot history" />
        </div>
      ) : !data?.rows.length ? (
        <Empty title={res.loading ? "Loading…" : "No shots yet"}>Shots appear here the moment they are fired.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left">
                {["Shot", "Player", "Barrier", "Particles", "Bet", "Paid", "Time", ""].map((h) => (
                  <th key={h} className="label px-4 py-3 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const v = VOLATILITY[r.volatility];
                const won = BigInt(r.payout) > BigInt(r.stake);
                return (
                  <tr key={r.id} className="border-b border-line-soft last:border-0 hover:bg-panel-2/50">
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link href={`/history/bet/${r.id}`} className="text-fg-2 hover:text-cyan">
                        #{r.id}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">
                      <div className="flex items-center gap-2">
                        <Link href={`/profile/${r.wallet}`} className="hover:text-cyan">
                          {shortKey(r.wallet)}
                        </Link>
                        <SolscanLink address={r.wallet} />
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: v.color }}>
                      {v.short} · {formatMultiplier(r.multiplierBps)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Hits hits={r.outcomeBits.split("").map((b) => b === "1")} />
                        <span className="font-mono text-[11px] text-muted">
                          {r.wins}/{r.count}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{formatTunnel(BigInt(r.stake))}</td>
                    <td className={cx("px-4 py-3 font-mono text-xs", won ? "text-flare" : "text-muted")}>{formatTunnel(BigInt(r.payout))}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-faint">{new Date(r.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-4 py-3 text-right font-mono text-[11px]">
                      <Link href={`/history/bet/${r.id}`} className="text-muted hover:text-cyan">
                        Verify →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-line-soft px-4 py-3">
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Newer
          </Button>
          <span className="font-mono text-[11px] text-faint">
            page {page + 1} / {pages}
          </span>
          <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
            Older
          </Button>
        </div>
      )}
    </Panel>
  );
}
