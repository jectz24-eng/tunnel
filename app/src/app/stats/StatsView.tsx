"use client";

import { BARRIER_META, formatBps, formatSol, formatTunnel } from "@tunnel/sdk";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard, ChartTooltip, axisProps, gridProps } from "@/components/charts";
import { Empty, Panel, Stat, Val } from "@/components/ui";
import { useIndexed } from "@/lib/api";

interface SeriesRow {
  id: string;
  openTs: string;
  outcome: string;
  totalLamports: string;
  participants: number;
  particles: string[];
  successes: string[];
  barrierBps: number[];
  feeLamports: string;
  tokensAllocated: string;
}

interface StatsPayload {
  summary: {
    state: null | {
      totalLamportsCommitted: string;
      totalParticles: string;
      totalSuccesses: string;
      totalTokensAllocated: string;
      totalFeesLamports: string;
      roundsSettled: string;
      updatedAt: string;
    };
    rounds: number;
    participants: number;
  };
  series: SeriesRow[];
}

const SOL = (l: bigint) => Number(l) / 1e9;

export function StatsView() {
  const res = useIndexed<StatsPayload>("/api/stats?rounds=120", 15_000);
  const loading = res.loading && !res.data;
  const unavailable = res.data && !res.data.available;
  const d = res.data?.data;
  const s = d?.summary.state;
  const series = d?.series ?? [];

  const solData = series.map((r) => ({ round: `#${r.id}`, sol: SOL(BigInt(r.totalLamports)) }));
  const particleData = series.map((r) => ({ round: `#${r.id}`, I: Number(r.particles[0]), II: Number(r.particles[1]), III: Number(r.particles[2]) }));
  const emissionData = series.filter((r) => r.outcome === "rewards").map((r) => ({ round: `#${r.id}`, tokens: Number(BigInt(r.tokensAllocated)) / 1e6 }));

  // Observed vs configured transmission across settled rounds that produced outcomes.
  const settled = series.filter((r) => r.outcome === "rewards" || r.outcome === "noSuccessRefund");
  const observed = [0, 1, 2].map((b) => {
    const n = settled.reduce((a, r) => a + BigInt(r.particles[b]), 0n);
    const k = settled.reduce((a, r) => a + BigInt(r.successes[b]), 0n);
    const configured = settled.at(-1)?.barrierBps[b] ?? null;
    return { n, k, rate: n > 0n ? Number((k * 10_000n) / n) : null, configured };
  });

  if (unavailable) {
    return (
      <Panel className="mt-10">
        <Empty title="Statistics are unavailable">The indexer database is not reachable from this deployment. Live round state on the Mine page reads the chain directly and is unaffected.</Empty>
      </Panel>
    );
  }

  return (
    <div className="mt-10 space-y-4">
      <Panel>
        <div className="grid grid-cols-2 gap-px bg-line-soft md:grid-cols-3 lg:grid-cols-6">
          {[
            ["SOL committed", s ? formatSol(BigInt(s.totalLamportsCommitted), 2) : null],
            ["Particles", s ? BigInt(s.totalParticles).toLocaleString() : null],
            ["Successful tunnels", s ? BigInt(s.totalSuccesses).toLocaleString() : null],
            ["$TUNNEL allocated", s ? formatTunnel(BigInt(s.totalTokensAllocated), 0) : null],
            ["Protocol fees", s ? `${formatSol(BigInt(s.totalFeesLamports), 3)} SOL` : null],
            ["Unique wallets", d ? d.summary.participants.toLocaleString() : null],
          ].map(([k, v]) => (
            <div key={k} className="bg-panel p-5">
              <Stat label={k} value={<Val v={v} loading={loading} />} />
            </div>
          ))}
        </div>
        <div className="border-t border-line-soft px-5 py-2.5 font-mono text-[10.5px] text-faint">
          source: indexer (reconciled against onchain accounts){s ? ` · updated ${new Date(s.updatedAt).toLocaleTimeString()}` : ""}
        </div>
      </Panel>

      {series.length === 0 && !loading ? (
        <Panel>
          <Empty title="No settled rounds yet">Charts populate as rounds settle. Nothing here is simulated.</Empty>
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            {observed.map((o, b) => (
              <Panel key={b} className="p-5">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[11px] tracking-[0.14em]" style={{ color: BARRIER_META[b].color }}>
                    BARRIER {BARRIER_META[b].numeral}
                  </span>
                  <span className="font-mono text-[10.5px] text-faint">{o.n.toLocaleString()} particles</span>
                </div>
                <div className="mt-4 flex items-end gap-6">
                  <Stat label="Observed" value={o.rate != null ? formatBps(o.rate) : "—"} />
                  <Stat label="Configured" value={o.configured != null ? formatBps(o.configured) : "—"} />
                </div>
                <p className="mt-3 text-[11.5px] text-muted">
                  {o.k.toLocaleString()} of {o.n.toLocaleString()} tunnelled across the last {settled.length} settled rounds.
                </p>
              </Panel>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="SOL committed per round"
              subtitle="Settled and refunded rounds, oldest → newest"
              table={{ columns: ["Round", "SOL"], rows: solData.map((r) => [r.round, r.sol.toFixed(4)]) }}
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={solData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barCategoryGap={2}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="round" {...axisProps} minTickGap={24} />
                  <YAxis {...axisProps} width={44} />
                  <Tooltip cursor={{ fill: "rgba(131,146,165,0.08)" }} content={<ChartTooltip format={(v) => `${v.toFixed(4)} SOL`} />} />
                  <Bar dataKey="sol" name="SOL" fill={BARRIER_META[1].chart} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Particles per barrier"
              subtitle="Stacked by barrier"
              legend={BARRIER_META.map((m) => ({ label: `Barrier ${m.numeral}`, color: m.chart }))}
              table={{ columns: ["Round", "I", "II", "III"], rows: particleData.map((r) => [r.round, r.I, r.II, r.III]) }}
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={particleData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barCategoryGap={2}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="round" {...axisProps} minTickGap={24} />
                  <YAxis {...axisProps} width={44} allowDecimals={false} />
                  <Tooltip cursor={{ fill: "rgba(131,146,165,0.08)" }} content={<ChartTooltip />} />
                  {(["I", "II", "III"] as const).map((k, i) => (
                    <Bar key={k} dataKey={k} name={`Barrier ${k}`} stackId="p" fill={BARRIER_META[i].chart} stroke="#0D131B" strokeWidth={1} radius={i === 2 ? [4, 4, 0, 0] : 0} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <ChartCard
            title="$TUNNEL allocated per round"
            subtitle="Rounds with at least one successful tunnel; follows the declining emission schedule"
            table={{ columns: ["Round", "$TUNNEL"], rows: emissionData.map((r) => [r.round, r.tokens.toFixed(2)]) }}
          >
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={emissionData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="round" {...axisProps} minTickGap={24} />
                <YAxis {...axisProps} width={52} />
                <Tooltip cursor={{ stroke: "#56657A", strokeDasharray: "3 3" }} content={<ChartTooltip format={(v) => `${v.toFixed(2)} $TUNNEL`} />} />
                <Line type="monotone" dataKey="tokens" name="$TUNNEL" stroke={BARRIER_META[0].chart} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "#0D131B", strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </>
      )}
    </div>
  );
}
