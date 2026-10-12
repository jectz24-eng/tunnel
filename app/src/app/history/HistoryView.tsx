"use client";

import { BARRIER_META, LEVEL_LABELS, formatMilli, formatPpb, formatTunnel, shortKey } from "@tunnel/sdk";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Empty, Panel, Unavailable, cx } from "@/components/ui";
import { useIndexed } from "@/lib/api";
import { explorerTx } from "@/lib/config";

export interface ExperimentRow {
  cycleId: string;
  owner: string;
  seq: number;
  id: string;
  /** The wallet's ed25519 signature over the deployment message. */
  signature: string;
  createdAt: string;
  barrier: number;
  level: number;
  count: number;
  firstIndex: number;
  energyCost: number;
  heightMilli: number;
  widthMilli: number;
  energyBps: number;
  transmissionPpb: number;
  nominalReward: string;
  status: string;
  successes: number | null;
  outcomeBits: string | null;
  rewardTokens: string | null;
}

export const STATUS_TONE: Record<string, "neutral" | "cyan" | "violet" | "flare" | "amber" | "red" | "ion"> = {
  pending: "cyan",
  settled: "flare",
  claimed: "ion",
  void: "red",
};

/** Global experiment archive: search, filters, pagination. Every row links to its proof. */
export function HistoryView({ owner }: { owner?: string }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [barrier, setBarrier] = useState<string>("");
  const [outcome, setOutcome] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => setPage(0), [debounced, barrier, outcome, status]);

  const params = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (owner) params.set("owner", owner);
  if (debounced) params.set("q", debounced);
  if (barrier) params.set("barrier", barrier);
  if (outcome) params.set("outcome", outcome);
  if (status) params.set("status", status);
  const res = useIndexed<{ rows: ExperimentRow[]; total: number; page: number; pageSize: number }>(`/api/experiments?${params}`, 10_000);
  const data = res.data?.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line-soft p-4 lg:flex-row lg:items-center">
        {!owner && (
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" fill="none" />
              <path d="M9.5 9.5 13 13" stroke="currentColor" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search wallet, signature, cycle number or experiment id (cycle-wallet-seq)"
              aria-label="Search experiments"
              className="h-10 w-full rounded-lg border border-line bg-bg-2 pl-9 pr-3 font-mono text-[12.5px] placeholder:text-faint focus:border-cyan/50 focus:outline-none"
            />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Select label="Barrier" value={barrier} onChange={setBarrier} options={[["", "All barriers"], ["0", "Low"], ["1", "Medium"], ["2", "High"]]} />
          <Select label="Outcome" value={outcome} onChange={setOutcome} options={[["", "All outcomes"], ["tunneled", "Tunneled"], ["reflected", "Reflected"]]} />
          <Select label="Status" value={status} onChange={setStatus} options={[["", "Any status"], ["pending", "Pending"], ["settled", "Settled"], ["claimed", "Claimed"], ["void", "Void"]]} />
        </div>
      </div>
      {res.data && !res.data.available ? (
        <div className="p-4">
          <Unavailable what="The experiment archive" />
        </div>
      ) : !data ? (
        <Empty title="Loading experiments…" />
      ) : data.rows.length === 0 ? (
        <Empty title="No experiments match">Try a different search or filter.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Experiment", "Wallet", "Cycle · time", "Barrier (V₀ · a)", "Energy", "Probability", "Outcome", "Reward", "Status", "Tx"].map((h) => (
                  <th key={h} className="label whitespace-nowrap px-4 py-3 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={`${r.cycleId}-${r.owner}-${r.seq}`} className="border-b border-line-soft last:border-0 hover:bg-panel-2/40">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                    <Link href={`/history/${r.cycleId}/${r.owner}/${r.seq}`} className="text-fg-2 hover:text-cyan">
                      EXP-{r.cycleId}-{r.owner.slice(0, 4)}-{r.seq}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link href={`/profile/${r.owner}`} className="text-muted hover:text-cyan">
                      {shortKey(r.owner)}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted">
                    <Link href={`/history/cycle/${r.cycleId}`} className="text-fg-2 hover:text-cyan">
                      #{r.cycleId}
                    </Link>{" "}
                    · {new Date(r.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                    <span style={{ color: BARRIER_META[r.barrier].color }}>{BARRIER_META[r.barrier].short}</span>
                    <span className="text-faint">
                      {" "}
                      ({formatMilli(r.heightMilli, 1)} · {formatMilli(r.widthMilli, 1)})
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                    {r.count} × {LEVEL_LABELS[r.level]} <span className="text-faint">⚡{r.energyCost}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{formatPpb(r.transmissionPpb)}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                    {r.successes == null ? <span className="text-faint">not revealed</span> : r.successes > 0 ? <span className="text-flare">{r.successes}/{r.count} tunneled</span> : <span className="text-amber">0/{r.count} reflected</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{r.rewardTokens != null ? formatTunnel(BigInt(r.rewardTokens)) : "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status.replace("_", " ")}</Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    <a href={explorerTx(r.signature)} target="_blank" rel="noreferrer" className="text-muted hover:text-cyan">
                      {r.signature.slice(0, 6)}…
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between border-t border-line-soft px-4 py-3 font-mono text-[11px] text-muted">
          <span>
            {data.total.toLocaleString()} experiment{data.total === 1 ? "" : "s"} · page {page + 1} / {pages}
          </span>
          <div className="flex gap-1">
            <button className="rounded-md border border-line px-3 py-1.5 hover:border-muted/50 disabled:opacity-40" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Prev
            </button>
            <button className="rounded-md border border-line px-3 py-1.5 hover:border-muted/50 disabled:opacity-40" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cx("h-10 rounded-lg border border-line bg-bg-2 px-3 font-mono text-[12px] text-fg-2 focus:border-cyan/50 focus:outline-none", value && "border-cyan/40 text-cyan")}
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
