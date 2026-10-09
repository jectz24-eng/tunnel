"use client";

import { formatSol, formatTunnel } from "@tunnel/sdk";
import { Stat, Val } from "@/components/ui";
import { splitRounds, useChainClock, useRounds } from "@/lib/chain";
import { appConfig, clusterLabel } from "@/lib/config";

/** Protocol totals read directly from the onchain Protocol account (not the indexer). */
export function ProtocolStats() {
  const { now } = useChainClock(1000);
  const rounds = useRounds(2);
  const p = rounds.protocol.data;
  const loading = rounds.protocol.loading && p === undefined;
  const { current, recent } = splitRounds(rounds.data, now);
  const roundNo = current?.id ?? recent[0]?.id;

  const items = [
    { label: "SOL committed", value: p ? `${formatSol(p.totalLamportsCommitted, 2)}` : null, sub: "all rounds" },
    { label: "Particles deployed", value: p ? p.totalParticles.toLocaleString() : null, sub: "mining attempts" },
    { label: "Successful tunnels", value: p ? p.totalSuccesses.toLocaleString() : null, sub: "settled rounds", accent: "#45E6B0" },
    { label: "$TUNNEL distributed", value: p ? formatTunnel(p.totalTokensAllocated, 0) : null, sub: "allocated to successes" },
    { label: "Current round", value: roundNo != null ? roundNo.toLocaleString() : null, sub: current ? "open" : p ? "between rounds" : undefined },
    { label: "Reward reserve", value: p ? formatTunnel(p.reserveAvailable, 0) : null, sub: "uncommitted $TUNNEL" },
  ];

  return (
    <div className="panel">
      <div className="flex items-center justify-between border-b border-line-soft px-5 py-3">
        <span className="label">Protocol state</span>
        <span className="font-mono text-[10.5px] text-faint">
          source: onchain Protocol account · {clusterLabel[appConfig.cluster].toLowerCase()}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-px bg-line-soft sm:grid-cols-3 lg:grid-cols-6">
        {items.map((it) => (
          <div key={it.label} className="bg-panel px-5 py-5">
            <Stat label={it.label} value={<Val v={it.value} loading={loading} />} sub={it.sub} accent={it.value ? it.accent : undefined} />
          </div>
        ))}
      </div>
    </div>
  );
}
