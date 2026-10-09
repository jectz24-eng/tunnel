"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { BARRIER_META, formatBps, formatSol, formatTunnel, shortKey } from "@tunnel/sdk";
import { Empty, Panel, Skeleton, cx } from "@/components/ui";
import { useIndexed } from "@/lib/api";
import { explorerAddress } from "@/lib/config";
import { useState } from "react";

interface Row {
  rank: number;
  owner: string;
  particles: string;
  successes: string;
  tokens: string;
  solRewards: string;
  rateBps: number | null;
  rounds: number;
}

type Sort = "tokens" | "successes" | "particles" | "rate" | "sol";
const COLS: { key: Sort | null; label: string; align?: "right" }[] = [
  { key: null, label: "Rank" },
  { key: null, label: "Wallet" },
  { key: "particles", label: "Particles", align: "right" },
  { key: "successes", label: "Tunnels", align: "right" },
  { key: "rate", label: "Success rate", align: "right" },
  { key: "tokens", label: "$TUNNEL mined", align: "right" },
  { key: "sol", label: "SOL rewards", align: "right" },
];

export function LeaderboardView() {
  const { publicKey } = useWallet();
  const [sort, setSort] = useState<Sort>("tokens");
  const [period, setPeriod] = useState("all");
  const [barrier, setBarrier] = useState<string>("all");
  const q = `/api/leaderboard?sort=${sort}&period=${period}${barrier !== "all" ? `&barrier=${barrier}` : ""}${publicKey ? `&wallet=${publicKey.toBase58()}` : ""}`;
  const res = useIndexed<{ rows: Row[]; total: number; you: Row | null }>(q, 15_000);
  const data = res.data?.data;
  const me = publicKey?.toBase58();

  return (
    <div className="mt-10">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented value={period} onChange={setPeriod} options={[["all", "All time"], ["30d", "30 days"], ["7d", "7 days"], ["24h", "24 hours"]]} />
        <Segmented
          value={barrier}
          onChange={setBarrier}
          options={[["all", "All barriers"], ...BARRIER_META.map((m, i) => [String(i), `Barrier ${m.numeral}`] as [string, string])]}
        />
        {data && <span className="ml-auto font-mono text-[11px] text-muted">{data.total.toLocaleString()} wallets</span>}
      </div>

      {data?.you && (
        <Panel className="mb-3 border-cyan/30">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 px-5 py-3 font-mono text-[12.5px]">
            <span className="label text-cyan">Your position</span>
            <span className="text-fg">#{data.you.rank}</span>
            <span className="text-muted">
              {BigInt(data.you.successes).toLocaleString()} tunnels · {formatTunnel(BigInt(data.you.tokens))} $TUNNEL · {formatSol(BigInt(data.you.solRewards))} SOL
            </span>
          </div>
        </Panel>
      )}

      <Panel className="overflow-hidden">
        {res.data && !res.data.available ? (
          <Empty title="Leaderboard unavailable">The indexer is not reachable from this deployment.</Empty>
        ) : data && data.rows.length === 0 ? (
          <Empty title="No miners yet">Rankings appear once wallets deploy particles in a round.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th key={c.label} className={cx("label px-5 py-3 font-normal", c.align === "right" ? "text-right" : "text-left")} aria-sort={c.key && sort === c.key ? "descending" : undefined}>
                      {c.key ? (
                        <button onClick={() => setSort(c.key!)} className={cx("uppercase tracking-[0.08em] hover:text-fg", sort === c.key && "text-cyan")}>
                          {c.label}
                          {sort === c.key && " ↓"}
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono tabular">
                {!data &&
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-t border-line-soft">
                      {COLS.map((c) => (
                        <td key={c.label} className="px-5 py-3">
                          <Skeleton className="h-3 w-16" />
                        </td>
                      ))}
                    </tr>
                  ))}
                {data?.rows.map((r) => (
                  <tr key={r.owner} className={cx("border-t border-line-soft", r.owner === me && "bg-cyan/[0.04]")}>
                    <td className={cx("px-5 py-3", r.rank <= 3 ? "text-fg" : "text-muted")}>{r.rank}</td>
                    <td className="px-5 py-3">
                      <a href={explorerAddress(r.owner)} target="_blank" rel="noreferrer" className="text-fg-2 hover:text-cyan">
                        {shortKey(r.owner, 5)}
                      </a>
                      {r.owner === me && <span className="ml-2 text-[10.5px] text-cyan">YOU</span>}
                    </td>
                    <td className="px-5 py-3 text-right text-fg-2">{BigInt(r.particles).toLocaleString()}</td>
                    <td className="px-5 py-3 text-right text-fg-2">{BigInt(r.successes).toLocaleString()}</td>
                    <td className="px-5 py-3 text-right text-fg-2">{r.rateBps != null ? formatBps(r.rateBps) : "—"}</td>
                    <td className="px-5 py-3 text-right text-fg">{barrier === "all" ? formatTunnel(BigInt(r.tokens)) : "—"}</td>
                    <td className="px-5 py-3 text-right text-fg">{barrier === "all" ? formatSol(BigInt(r.solRewards)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="mt-3 text-[11.5px] text-faint">
        Derived from indexed positions. $TUNNEL and SOL rewards count rounds that paid rewards (refunds excluded) and include amounts not yet claimed. Rewards are not
        split by barrier, so they are hidden when filtering by barrier.
      </p>
    </div>
  );
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex rounded-[10px] border border-line bg-panel p-0.5">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className={cx("rounded-lg px-3 py-1.5 text-[12px] transition-colors", value === v ? "bg-panel-2 text-fg" : "text-muted hover:text-fg")}>
          {label}
        </button>
      ))}
    </div>
  );
}
