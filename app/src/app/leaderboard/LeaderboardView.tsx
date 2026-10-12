"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { formatTunnel, shortKey } from "@tunnel/sdk";
import Link from "next/link";
import { useState } from "react";
import { Empty, Panel, Unavailable, cx } from "@/components/ui";
import { useIndexed } from "@/lib/api";

interface Row {
  rank: number;
  owner: string;
  cyclesPlayed: number;
  experiments: number;
  particles: string;
  successes: string;
  failures: string;
  tokensEarned: string;
  bestCycleTokens: string;
  longestStreak: number;
}

const CATEGORIES = [
  { key: "tunnels", label: "Most tunnels", value: (r: Row) => BigInt(r.successes).toLocaleString(), unit: "tunnels" },
  { key: "rewards", label: "Total rewards", value: (r: Row) => formatTunnel(BigInt(r.tokensEarned)), unit: "$TUNNEL" },
  { key: "particles", label: "Particles deployed", value: (r: Row) => BigInt(r.particles).toLocaleString(), unit: "particles" },
  { key: "best", label: "Best single cycle", value: (r: Row) => formatTunnel(BigInt(r.bestCycleTokens)), unit: "$TUNNEL" },
  { key: "streak", label: "Longest streak", value: (r: Row) => String(r.longestStreak), unit: "cycles" },
  { key: "active", label: "Most active", value: (r: Row) => String(r.cyclesPlayed), unit: "cycles" },
] as const;

const rate = (r: Row) => {
  const n = BigInt(r.successes) + BigInt(r.failures);
  return n > 0n ? `${(Number((BigInt(r.successes) * 10_000n) / n) / 100).toFixed(1)}%` : "—";
};

/** Leaderboards from verified (indexed + reconciled) data only. */
export function LeaderboardView() {
  const { publicKey } = useWallet();
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]["key"]>("tunnels");
  const c = CATEGORIES.find((x) => x.key === cat)!;
  const res = useIndexed<{ rows: Row[]; total: number; you: { rank: number; row: Row } | null }>(
    `/api/leaderboard?category=${cat}&limit=100${publicKey ? `&wallet=${publicKey.toBase58()}` : ""}`,
    15_000,
  );
  const data = res.data?.data;
  const podium = data?.rows.slice(0, 3) ?? [];

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
        <Unavailable what="Leaderboards" className="mt-6" />
      ) : (
        <>
          {podium.length > 0 && (
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {podium.map((r, i) => (
                <Panel key={r.owner} brackets className={cx("relative overflow-hidden p-6", i === 0 && "md:-translate-y-2")}>
                  <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full opacity-20 blur-3xl" style={{ background: ["#EAFBFF", "#00D9FF", "#885BFF"][i] }} />
                  <div className="font-mono text-[11px] tracking-[0.2em] text-faint">RANK {String(i + 1).padStart(2, "0")}</div>
                  <Link href={`/profile/${r.owner}`} className="mt-3 block font-mono text-lg hover:text-cyan">
                    {shortKey(r.owner, 6)}
                  </Link>
                  <div className="mt-5 font-mono text-[32px] font-medium tabular" style={{ color: ["#EAFBFF", "#00D9FF", "#B49BFF"][i] }}>
                    {c.value(r)}
                  </div>
                  <div className="label">{c.unit}</div>
                  <div className="mt-4 flex gap-4 font-mono text-[11px] text-muted">
                    <span>{r.cyclesPlayed} cycles</span>
                    <span>{rate(r)} success</span>
                  </div>
                </Panel>
              ))}
            </div>
          )}

          {data?.you && (
            <div className="mt-6 flex flex-wrap items-center gap-4 rounded-xl border border-cyan/30 bg-cyan/[0.05] px-5 py-3 font-mono text-sm">
              <span className="text-cyan">YOU</span>
              <span>rank #{data.you.rank}</span>
              <span className="text-muted">
                {c.value(data.you.row)} {c.unit}
              </span>
            </div>
          )}

          <Panel className="mt-6 overflow-hidden">
            {!data ? (
              <Empty title="Loading leaderboard…" />
            ) : data.rows.length === 0 ? (
              <Empty title="No ranked wallets yet">Wallets appear once their experiments are settled and verified.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left">
                      {["#", "Wallet", c.label, "Tunnels", "Particles", "Success rate", "Rewards", "Cycles"].map((h) => (
                        <th key={h} className="label px-5 py-3 font-normal">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => {
                      const mine = publicKey?.toBase58() === r.owner;
                      return (
                        <tr key={r.owner} className={cx("border-b border-line-soft last:border-0 hover:bg-panel-2/40", mine && "bg-cyan/[0.04]")}>
                          <td className="px-5 py-3 font-mono text-xs text-faint">{r.rank}</td>
                          <td className="px-5 py-3 font-mono text-xs">
                            <Link href={`/profile/${r.owner}`} className="text-fg-2 hover:text-cyan">
                              {shortKey(r.owner, 6)}
                            </Link>
                            {mine && <span className="ml-2 text-cyan">you</span>}
                          </td>
                          <td className="px-5 py-3 font-mono text-xs text-fg">{c.value(r)}</td>
                          <td className="px-5 py-3 font-mono text-xs">{BigInt(r.successes).toLocaleString()}</td>
                          <td className="px-5 py-3 font-mono text-xs">{BigInt(r.particles).toLocaleString()}</td>
                          <td className="px-5 py-3 font-mono text-xs">{rate(r)}</td>
                          <td className="px-5 py-3 font-mono text-xs">{formatTunnel(BigInt(r.tokensEarned))}</td>
                          <td className="px-5 py-3 font-mono text-xs">{r.cyclesPlayed}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <p className="mt-4 text-xs text-muted">
            Rankings are recomputed from settled positions (never incremented), so they cannot drift. Streak = consecutive cycles, each with at
            least one tunnel. Rewards include claimable amounts from finalized cycles. {data ? `${data.total} ranked wallets.` : ""}
          </p>
        </>
      )}
    </div>
  );
}
