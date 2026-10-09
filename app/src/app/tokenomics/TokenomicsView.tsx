"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import {
  BARRIER_META,
  DEFAULT_PARAMS,
  TUNNEL_MINING_RESERVE,
  TUNNEL_TOTAL_SUPPLY,
  emissionCurve,
  formatTunnel,
  rewardVaultPda,
  scheduledEmission,
} from "@tunnel/sdk";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard, ChartTooltip, axisProps, gridProps } from "@/components/charts";
import { ExternalLink, Panel, Stat, Val } from "@/components/ui";
import { useProtocol } from "@/lib/chain";
import { appConfig, explorerAddress } from "@/lib/config";
import { usePoll } from "@/lib/poll";

export function TokenomicsView() {
  const { connection } = useConnection();
  const protocol = useProtocol();
  const p = protocol.data;
  const params = p?.params ?? DEFAULT_PARAMS;
  const vault = usePoll(p ? "vault-balance" : null, async () => BigInt((await connection.getTokenAccountBalance(p!.rewardVault)).value.amount), 15_000);
  const supply = usePoll(p ? "mint-supply" : null, async () => BigInt((await connection.getTokenSupply(p!.tunnelMint)).value.amount), 60_000);
  const loading = protocol.loading && p === undefined;

  const curve = emissionCurve(params, 2_400, 40).map((c) => ({
    day: c.epoch,
    cumulative: Number(c.cumulative / 1_000_000n) / 1e6, // millions of $TUNNEL
  }));
  const currentEmission = scheduledEmission(params, p?.nextRoundId ?? 0n);
  const reserveM = Number(TUNNEL_MINING_RESERVE / 1_000_000n) / 1e6;

  const addresses: [string, string | null, string][] = [
    ["$TUNNEL mint", p?.tunnelMint.toBase58() ?? null, "SPL token mint (6 decimals)"],
    ["Mining reserve vault", p ? p.rewardVault.toBase58() : rewardVaultPda(appConfig.programId).toBase58(), "PDA token account; tokens leave only via claims"],
    ["Protocol treasury", p?.treasury.toBase58() ?? null, "receives the 5% protocol fee"],
    ["TUNNEL program", appConfig.programId.toBase58(), "Anchor program"],
  ];

  return (
    <div className="mt-10 space-y-4">
      <Panel>
        <div className="grid grid-cols-2 gap-px bg-line-soft md:grid-cols-3 lg:grid-cols-6">
          {[
            ["Total supply", "1,000,000,000", supply.data != null ? `onchain: ${formatTunnel(supply.data, 0)}` : "fixed design supply"],
            ["Mining allocation", "600,000,000", "60% · proposed"],
            ["Distributed", p ? formatTunnel(p.totalTokensAllocated, 0) : null, "allocated to successes"],
            ["Remaining in reserve", vault.data != null ? formatTunnel(vault.data, 0) : null, "vault balance"],
            ["Current emission", formatTunnel(currentEmission), "$TUNNEL per round"],
            ["Uncommitted reserve", p ? formatTunnel(p.reserveAvailable, 0) : null, "not yet budgeted to a round"],
          ].map(([k, v, sub]) => (
            <div key={k} className="bg-panel p-5">
              <Stat label={k} value={<Val v={v} loading={loading && (k === "Distributed" || k === "Uncommitted reserve")} />} sub={sub} />
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Panel className="p-5">
          <div className="label">Allocation</div>
          <div className="mt-5 flex h-3 overflow-hidden rounded-full">
            <div className="h-full" style={{ width: "60%", background: BARRIER_META[0].chart }} />
            <div className="h-full w-[2px] bg-panel" />
            <div
              className="h-full flex-1"
              style={{ backgroundImage: "repeating-linear-gradient(45deg, #1C2936 0 4px, transparent 4px 8px)", backgroundColor: "#0A0F16" }}
            />
          </div>
          <ul className="mt-5 space-y-4 text-[13px]">
            <li className="flex gap-3">
              <span className="mt-1 size-2.5 shrink-0 rounded-[2px]" style={{ background: BARRIER_META[0].chart }} />
              <div>
                <div className="flex gap-3">
                  <span className="text-fg">Mining reserve</span>
                  <span className="font-mono text-muted">600,000,000 · 60%</span>
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">Emitted to successful particles on a declining schedule. Held by the program; never withdrawable by the admin.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="mt-1 size-2.5 shrink-0 rounded-[2px] border border-line" style={{ backgroundImage: "repeating-linear-gradient(45deg, #56657A 0 1px, transparent 1px 3px)" }} />
              <div>
                <div className="flex gap-3">
                  <span className="text-fg">Unallocated</span>
                  <span className="font-mono text-muted">400,000,000 · 40%</span>
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-amber/90">Pending owner approval of final tokenomics. No allocation has been decided; nothing is presented here as final.</p>
              </div>
            </li>
          </ul>
        </Panel>

        <ChartCard
          title="Projected cumulative emission"
          subtitle={`${formatTunnel(params.initialEmissionPerRound)} $TUNNEL/round, ×${(params.emissionDecayBps / 10_000).toFixed(3)} every ${params.emissionEpochRounds.toLocaleString()} rounds (≈1 day). Capped by the funded reserve.`}
          table={{ columns: ["Day", "Cumulative (M $TUNNEL)"], rows: curve.map((c) => [c.day, c.cumulative.toFixed(2)]) }}
        >
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={curve} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="em" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor={BARRIER_META[0].chart} stopOpacity={0.3} />
                  <stop offset="1" stopColor={BARRIER_META[0].chart} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="day" {...axisProps} tickFormatter={(d) => `${Math.round(d / 365)}y`} ticks={[0, 365, 730, 1095, 1460, 1825, 2190]} />
              <YAxis {...axisProps} width={44} tickFormatter={(v) => `${v}M`} domain={[0, 620]} />
              <ReferenceLine y={reserveM} stroke="#56657A" strokeDasharray="4 4" label={{ value: "600M reserve", fill: "#8392A5", fontSize: 10.5, position: "insideTopRight" }} />
              <Tooltip cursor={{ stroke: "#56657A", strokeDasharray: "3 3" }} content={<ChartTooltip format={(v) => `${v.toFixed(1)}M $TUNNEL`} />} labelFormatter={(d) => `Day ${d}`} />
              <Area type="monotone" dataKey="cumulative" name="Cumulative" stroke={BARRIER_META[0].chart} strokeWidth={2} fill="url(#em)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <Panel>
        <div className="border-b border-line-soft px-5 py-3">
          <span className="label">Addresses · {appConfig.cluster}</span>
        </div>
        <ul>
          {addresses.map(([label, addr, note]) => (
            <li key={label} className="flex flex-col gap-1 border-t border-line-soft px-5 py-3 first:border-t-0 sm:flex-row sm:items-center sm:gap-6">
              <div className="w-48 shrink-0 text-[13px] text-fg">{label}</div>
              <div className="min-w-0 flex-1 break-all font-mono text-[12px] text-fg-2">
                {addr ? <ExternalLink href={explorerAddress(addr)}>{addr}</ExternalLink> : <span className="text-amber">Not yet created on this cluster</span>}
              </div>
              <div className="text-[11.5px] text-muted sm:w-64 sm:text-right">{note}</div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
