"use client";

import { BARRIER_META, formatMilli, formatTunnel, type BarrierConfig, type EnergyLevel } from "@tunnel/sdk";
import type { CycleAccount, ProtocolAccount } from "@/lib/types";
import { displayStatus, formatCountdown, statusTone } from "@/lib/cycle";
import type { ActivityEvent } from "@/lib/stream";
import { Badge, Dot, Val } from "../ui";

/** TELEMETRY — live protocol values, with explicit loading/unavailable states. */
export function TelemetryPanel({
  protocol,
  current,
  latest,
  now,
  loading,
  barrier,
  level,
  barrierIndex,
  activity,
}: {
  protocol: ProtocolAccount | null | undefined;
  current: CycleAccount | null;
  latest: CycleAccount | null;
  now: number;
  loading: boolean;
  barrier: BarrierConfig;
  level: EnergyLevel;
  barrierIndex: number;
  activity: { events: ActivityEvent[]; available: boolean | null; live: boolean };
}) {
  const status = protocol === null ? "OFFLINE" : protocol?.paused ? "PAUSED" : current ? "ACCELERATING" : latest ? displayStatus(latest, now) : loading ? "CONNECTING" : "STANDBY";
  const tone = status === "ACCELERATING" ? "cyan" : status === "PAUSED" || status === "OFFLINE" ? "amber" : latest ? statusTone[displayStatus(latest, now)] : "neutral";
  const v0 = barrier.heightMilli / 1000;
  const a = barrier.widthMilli / 1000;
  const e = (v0 * level.energyBps) / 10_000;
  const kappaA = a * Math.sqrt(v0 - e);
  const recent = activity.events.filter((x) => Date.now() - Date.parse(x.createdAt) < 600_000);
  const deploys = recent.filter((x) => x.name === "ParticlesDeployed").length;
  const particles = current ? current.particles.reduce((s, x) => s + x, 0n) : null;

  const rows: [string, React.ReactNode][] = [
    ["Current mining cycle", current ? `#${current.id}` : protocol?.paused ? "paused" : protocol ? "opening…" : null],
    ["Time remaining", current ? <span className="text-cyan">{formatCountdown(current.closeTs - now)}</span> : protocol ? "—" : null],
    ["Active participants", current ? current.participants.toLocaleString() : null],
    ["Particles this cycle", particles != null ? particles.toString() : null],
    ["Particles all time", protocol ? protocol.totals.particles.toLocaleString() : null],
    ["Successful tunnels", protocol ? protocol.totals.successes.toLocaleString() : null],
    ["Cycle emission budget", current ? `${formatTunnel(current.emissionBudget, 0)}` : null],
    ["Reserve available", protocol ? `${formatTunnel(protocol.reserveAvailable, 0)}` : null],
  ];

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-line-soft px-5 py-4">
        <span className="label">Accelerator status</span>
        <Badge tone={tone}>
          <Dot color={tone === "cyan" ? "#00D9FF" : tone === "amber" ? "#F0A64B" : "#81909F"} pulse={status === "ACCELERATING"} />
          {status}
        </Badge>
      </div>
      {current && (
        <div className="border-b border-line-soft px-5 py-3">
          <div className="h-1 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-[linear-gradient(90deg,#2864FF,#00D9FF)]" style={{ width: `${Math.min(100, ((now - current.openTs) / (current.closeTs - current.openTs)) * 100)}%` }} />
          </div>
        </div>
      )}
      <dl className="divide-y divide-line-soft">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between px-5 py-2.5">
            <dt className="text-[12.5px] text-muted">{k}</dt>
            <dd className="font-mono text-[13px] tabular">
              <Val v={v} loading={loading} />
            </dd>
          </div>
        ))}
        <div className="flex items-center justify-between px-5 py-2.5">
          <dt className="text-[12.5px] text-muted">Network activity · 10 min</dt>
          <dd className="font-mono text-[13px] tabular">
            {activity.available === false ? <span className="text-faint">offline</span> : activity.available == null ? <Val v={null} loading /> : `${deploys} deployments`}
          </dd>
        </div>
      </dl>
      <div className="border-t border-line-soft px-5 py-4">
        <div className="label mb-3 flex items-center justify-between">
          <span>Barrier parameters</span>
          <span style={{ color: BARRIER_META[barrierIndex].color }}>{BARRIER_META[barrierIndex].short}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[12px]">
          <span className="text-muted">V₀</span>
          <span className="text-right tabular">{formatMilli(barrier.heightMilli)}</span>
          <span className="text-muted">a</span>
          <span className="text-right tabular">{formatMilli(barrier.widthMilli)}</span>
          <span className="text-muted">E</span>
          <span className="text-right tabular">{e.toFixed(3)}</span>
          <span className="text-muted">κa</span>
          <span className="text-right tabular">{kappaA.toFixed(3)}</span>
          <span className="text-muted">E (electron)</span>
          <span className="text-right tabular">{(e * 3.81).toFixed(2)} eV</span>
        </div>
      </div>
    </div>
  );
}
