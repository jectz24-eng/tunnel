"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { BARRIER_META, formatBps, formatSol, formatTunnel } from "@tunnel/sdk";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard, ChartTooltip, axisProps, gridProps } from "@/components/charts";
import { ClaimsPanel, useClaimRows } from "@/components/mine/ClaimsPanel";
import { Badge, Button, Empty, Panel, Stat, Val, cx } from "@/components/ui";
import { WalletPicker } from "@/components/WalletButton";
import { useWalletAuth } from "@/components/WalletAuth";
import { useIndexed } from "@/lib/api";
import { useBalances, useChainClock } from "@/lib/chain";
import { explorerTx } from "@/lib/config";
import { outcomeLabel } from "@/lib/round";

interface PositionRow {
  roundId: string;
  openTs: string;
  status: string;
  outcome: "pending" | "rewards" | "noSuccessRefund" | "fullRefund" | "empty";
  particles: number[];
  successes: number[];
  lamports: string;
  settled: boolean;
  claimed: boolean;
  lamportsPaid: string;
  tokensPaid: string;
  expectedLamports: string | null;
  expectedTokens: string | null;
}
interface TxRow {
  signature: string;
  roundId: string;
  blockTime: string | null;
  lamports: string;
  count?: number;
  barrier?: number;
  tokens?: string;
}
interface WalletPayload {
  positions: PositionRow[];
  deposits: TxRow[];
  claims: TxRow[];
}

const RANGES: [string, string, number | null][] = [
  ["all", "All time", null],
  ["30d", "30 days", 30],
  ["7d", "7 days", 7],
  ["24h", "24 hours", 1],
];

export function DashboardView() {
  const { publicKey } = useWallet();
  const [picker, setPicker] = useState(false);
  const { now } = useChainClock(1000);
  const auth = useWalletAuth();
  const balances = useBalances(publicKey ?? null);
  const owner = publicKey?.toBase58();
  const res = useIndexed<WalletPayload>(owner ? `/api/wallet/${owner}` : null, 12_000);
  const claimRows = useClaimRows();
  const [range, setRange] = useState("all");
  const [barrier, setBarrier] = useState<number | null>(null);

  const since = RANGES.find((r) => r[0] === range)?.[2];
  const positions = useMemo(() => {
    const all = res.data?.data?.positions ?? [];
    return all.filter((p) => (since ? Date.parse(p.openTs) >= Date.now() - since * 86_400_000 : true)).filter((p) => (barrier == null ? true : p.particles[barrier] > 0));
  }, [res.data, since, barrier]);

  const agg = useMemo(() => {
    let committed = 0n, received = 0n, particles = 0, settledParticles = 0, successes = 0, tokens = 0n;
    for (const p of positions) {
      const parts = barrier == null ? p.particles.reduce((a, b) => a + b, 0) : p.particles[barrier];
      const succ = barrier == null ? p.successes.reduce((a, b) => a + b, 0) : p.successes[barrier];
      particles += parts;
      committed += BigInt(p.lamports);
      if (p.settled) {
        settledParticles += parts;
        successes += succ;
      }
      if (p.claimed) received += BigInt(p.lamportsPaid);
      tokens += p.claimed ? BigInt(p.tokensPaid) : BigInt(p.expectedTokens ?? "0");
    }
    return { committed, received, particles, settledParticles, successes, failures: settledParticles - successes, tokens };
  }, [positions, barrier]);

  const unclaimedSol = claimRows.rows.reduce((a, r) => a + (r.payout?.lamports ?? 0n), 0n);
  const unclaimedTok = claimRows.rows.reduce((a, r) => a + (r.payout?.tokens ?? 0n), 0n);

  const chart = positions
    .filter((p) => p.status === "settled" || p.status === "failed")
    .slice(0, 40)
    .reverse()
    .map((p) => ({
      round: `#${p.roundId}`,
      committed: Number(BigInt(p.lamports)) / 1e9,
      returned: Number(BigInt(p.claimed ? p.lamportsPaid : (p.expectedLamports ?? "0"))) / 1e9,
    }));

  if (!publicKey) {
    return (
      <Panel className="mt-10">
        <Empty title="Connect a wallet to see your dashboard">Your deposits, outcomes, rewards and claim history, all read from chain and the indexer.</Empty>
        <div className="flex justify-center pb-10">
          <Button variant="primary" onClick={() => setPicker(true)}>
            Connect Wallet
          </Button>
        </div>
        <WalletPicker open={picker} onClose={() => setPicker(false)} />
      </Panel>
    );
  }

  const indexerDown = res.data && !res.data.available;
  const loading = res.loading && !res.data;
  const net = agg.received - agg.committed;

  return (
    <div className="mt-8 space-y-4">
      <Panel>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
          <div className="min-w-0">
            <div className="label">Connected wallet</div>
            <div className="mt-1 break-all font-mono text-[13px] text-fg">{owner}</div>
          </div>
          <div>
            <div className="label">SOL balance</div>
            <div className="mt-1 font-mono text-[13px]">{balances.data ? formatSol(balances.data.lamports) : "—"}</div>
          </div>
          <div>
            <div className="label">$TUNNEL balance</div>
            <div className="mt-1 font-mono text-[13px]">{balances.data?.tunnel != null ? formatTunnel(balances.data.tunnel) : "—"}</div>
          </div>
          <div className="ml-auto">
            {auth.status === "verified" ? <Badge tone="green">Ownership verified</Badge> : <Button size="sm" onClick={() => void auth.signIn()}>Verify ownership</Button>}
          </div>
        </div>
      </Panel>

      <div className="flex flex-wrap gap-2">
        <div className="flex rounded-[10px] border border-line bg-panel p-0.5">
          {RANGES.map(([k, label]) => (
            <button key={k} onClick={() => setRange(k)} className={cx("rounded-lg px-3 py-1.5 text-[12px]", range === k ? "bg-panel-2 text-fg" : "text-muted hover:text-fg")}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex rounded-[10px] border border-line bg-panel p-0.5">
          {[null, 0, 1, 2].map((b) => (
            <button key={String(b)} onClick={() => setBarrier(b)} className={cx("rounded-lg px-3 py-1.5 text-[12px]", barrier === b ? "bg-panel-2 text-fg" : "text-muted hover:text-fg")}>
              {b == null ? "All barriers" : `Barrier ${BARRIER_META[b].numeral}`}
            </button>
          ))}
        </div>
      </div>

      {indexerDown ? (
        <Panel>
          <Empty title="History unavailable">The indexer is not reachable. Claimable rewards below are read directly from chain and remain accurate.</Empty>
        </Panel>
      ) : (
        <>
          <Panel>
            <div className="grid grid-cols-2 gap-px bg-line-soft md:grid-cols-4 lg:grid-cols-5">
              {[
                ["SOL committed", formatSol(agg.committed)],
                ["SOL received", formatSol(agg.received)],
                ["Net SOL result", `${net >= 0n ? "+" : ""}${formatSol(net)}`],
                ["Particles deployed", agg.particles.toLocaleString()],
                ["Successful tunnels", agg.successes.toLocaleString()],
                ["Failed tunnels", agg.failures.toLocaleString()],
                ["Success rate", agg.settledParticles ? formatBps(Math.round((agg.successes / agg.settledParticles) * 10_000)) : "—"],
                ["$TUNNEL mined", barrier == null ? formatTunnel(agg.tokens) : "—"],
                ["Claimable SOL", formatSol(unclaimedSol)],
                ["Claimable $TUNNEL", formatTunnel(unclaimedTok)],
              ].map(([k, v]) => (
                <div key={k} className="bg-panel p-5">
                  <Stat label={k} value={<Val v={v} loading={loading} />} accent={k === "Net SOL result" && !loading ? (net >= 0n ? "#45E6B0" : "#FF7285") : undefined} />
                </div>
              ))}
            </div>
            <p className="border-t border-line-soft px-5 py-2.5 text-[11px] text-faint">
              Net SOL result = SOL received from claims − SOL committed (unclaimed rewards excluded). $TUNNEL is reported separately and never folded into a SOL figure.
            </p>
          </Panel>

          {chart.length > 0 && (
            <ChartCard
              title="SOL committed vs returned, per round"
              subtitle="Returned = rewards or refunds (claimed or claimable). Latest 40 settled rounds."
              legend={[
                { label: "Committed", color: BARRIER_META[1].chart },
                { label: "Returned", color: BARRIER_META[0].chart },
              ]}
              table={{ columns: ["Round", "Committed SOL", "Returned SOL"], rows: chart.map((c) => [c.round, c.committed.toFixed(4), c.returned.toFixed(4)]) }}
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="round" {...axisProps} minTickGap={20} />
                  <YAxis {...axisProps} width={48} />
                  <Tooltip cursor={{ fill: "rgba(131,146,165,0.08)" }} content={<ChartTooltip format={(v) => `${v.toFixed(4)} SOL`} />} />
                  <Bar dataKey="committed" name="Committed" fill={BARRIER_META[1].chart} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="returned" name="Returned" fill={BARRIER_META[0].chart} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </>
      )}

      <Panel>
        <div className="border-b border-line-soft px-4 py-3">
          <span className="label">Claimable rewards · onchain</span>
        </div>
        <ClaimsPanel now={now} />
      </Panel>

      {!indexerDown && (
        <div className="grid gap-4 lg:grid-cols-2">
          <HistoryTable
            title="Round history"
            columns={["Round", "Outcome", "Particles", "Tunnels", "Committed", "Returned", "$TUNNEL"]}
            rows={positions.map((p) => [
              `#${p.roundId}`,
              p.status === "settled" || p.status === "failed" ? outcomeLabel[p.outcome] : p.status,
              String(p.particles.reduce((a, b) => a + b, 0)),
              p.settled ? String(p.successes.reduce((a, b) => a + b, 0)) : "—",
              formatSol(BigInt(p.lamports)),
              p.claimed ? formatSol(BigInt(p.lamportsPaid)) : p.expectedLamports ? `${formatSol(BigInt(p.expectedLamports))} (unclaimed)` : "—",
              p.claimed ? formatTunnel(BigInt(p.tokensPaid)) : p.expectedTokens ? formatTunnel(BigInt(p.expectedTokens)) : "—",
            ])}
          />
          <HistoryTable
            title="Transactions"
            columns={["Time", "Type", "Round", "Amount", "Signature"]}
            rows={[
              ...(res.data?.data?.deposits ?? []).map((d) => ({ t: d.blockTime, row: ["Deposit", `#${d.roundId}`, `−${formatSol(BigInt(d.lamports))} SOL · ${d.count} on ${BARRIER_META[d.barrier ?? 0].numeral}`], sig: d.signature })),
              ...(res.data?.data?.claims ?? []).map((c) => ({ t: c.blockTime, row: ["Claim", `#${c.roundId}`, `+${formatSol(BigInt(c.lamports))} SOL · ${formatTunnel(BigInt(c.tokens ?? "0"))} $TUNNEL`], sig: c.signature })),
            ]
              .sort((a, b) => Date.parse(b.t ?? "0") - Date.parse(a.t ?? "0"))
              .map((x) => [x.t ? new Date(x.t).toLocaleString() : "pending", ...x.row, <a key={x.sig} href={explorerTx(x.sig)} target="_blank" rel="noreferrer" className="text-cyan hover:underline">{x.sig.slice(0, 8)}…</a>])}
          />
        </div>
      )}
    </div>
  );
}

function HistoryTable({ title, columns, rows }: { title: string; columns: string[]; rows: React.ReactNode[][] }) {
  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-line-soft px-4 py-3">
        <span className="label">{title}</span>
      </div>
      {rows.length === 0 ? (
        <Empty title="Nothing yet" />
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full min-w-[520px] text-[12px]">
            <thead className="sticky top-0 bg-panel">
              <tr>
                {columns.map((c) => (
                  <th key={c} className="label px-4 py-2 text-left font-normal">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono tabular text-fg-2">
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line-soft">
                  {r.map((c, j) => (
                    <td key={j} className="whitespace-nowrap px-4 py-2">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
