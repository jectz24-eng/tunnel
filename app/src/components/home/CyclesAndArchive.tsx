"use client";

import { BARRIER_META, LEVEL_LABELS, formatPpb, formatTunnel, scheduledEmission, shortKey } from "@tunnel/sdk";
import Link from "next/link";
import { useIndexed } from "@/lib/api";
import { splitCycles, useChainClock, useCycles } from "@/lib/chain";
import { formatCountdown } from "@/lib/cycle";
import { Arrow, ButtonLink, Empty, SectionHeading, Unavailable, Val } from "../ui";

/** MINING CYCLES — the live cycle and the emissions reserve. */
export function MiningCycles() {
  const { now } = useChainClock(500);
  const cycles = useCycles();
  const protocol = cycles.protocol.data;
  const { current } = splitCycles(cycles.data, now);
  const loading = cycles.protocol.loading && protocol === undefined;
  const dur = current ? current.closeTs - current.openTs : (protocol?.params.cycleDurationSecs ?? 600);
  const progress = current ? Math.min(1, Math.max(0, (now - current.openTs) / dur)) : 0;
  const R = 92;
  const C = 2 * Math.PI * R;

  return (
    <section className="relative border-y border-line-soft bg-bg-2/40" aria-labelledby="cycles-title">
      <div className="mx-auto grid max-w-[1400px] gap-12 px-4 py-28 sm:px-6 lg:grid-cols-[1fr_1fr] lg:items-center">
        <div>
          <SectionHeading eyebrow="06 / Mining cycles" title={<span id="cycles-title">Every ten minutes, the barrier opens.</span>}>
            Each cycle gives every wallet a fresh energy allowance and a fixed $TUNNEL budget for everyone. When it closes, a future Solana block supplies the randomness,
            every particle is resolved, and rewards become claimable. Unused energy expires; unused budget returns to the reserve.
          </SectionHeading>
          <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line">
            {[
              ["Energy per wallet / cycle", protocol ? `${protocol.params.energyPerCycle} units` : null],
              ["Cycle budget", current ? `${formatTunnel(current.emissionBudget, 0)} $TUNNEL` : protocol ? `${formatTunnel(scheduledEmission(protocol.params, BigInt(protocol.totals.cycles) + 1n), 0)} $TUNNEL` : null],
              ["Reserve available", protocol ? `${formatTunnel(protocol.reserveAvailable, 0)}` : null],
              ["Distributed so far", protocol ? `${formatTunnel(protocol.totals.tokensClaimed, 0)}` : null],
            ].map(([k, v]) => (
              <div key={k} className="bg-panel p-5">
                <dt className="label">{k}</dt>
                <dd className="mt-2 font-mono text-lg tabular">
                  <Val v={v} loading={loading} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="flex justify-center">
          <div className="relative">
            <svg viewBox="0 0 220 220" className="size-[300px] sm:size-[360px]" role="img" aria-label={current ? `Cycle ${current.id} ${Math.round(progress * 100)}% elapsed` : "No open cycle"}>
              <circle cx="110" cy="110" r={R} fill="none" stroke="#1a2532" strokeWidth="2" />
              {Array.from({ length: 60 }, (_, i) => (
                <line key={i} x1="110" y1={110 - R - 8} x2="110" y2={110 - R - (i % 5 === 0 ? 14 : 11)} stroke="#26364a" transform={`rotate(${i * 6} 110 110)`} />
              ))}
              <circle
                cx="110"
                cy="110"
                r={R}
                fill="none"
                stroke="url(#cyc-g)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${C * progress} ${C}`}
                transform="rotate(-90 110 110)"
                style={{ filter: "drop-shadow(0 0 6px #00D9FF)" }}
              />
              <defs>
                <linearGradient id="cyc-g">
                  <stop offset="0" stopColor="#2864FF" />
                  <stop offset="1" stopColor="#00D9FF" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <div className="label">{current ? `Cycle ${current.id}` : "No open cycle"}</div>
              <div className="mt-2 font-mono text-[44px] font-medium tabular tracking-tight sm:text-[52px]">
                {current ? formatCountdown(current.closeTs - now) : "--:--"}
              </div>
              <div className="mt-1 text-xs text-muted">
                {current ? `${current.participants} wallets · ${current.particles.reduce((a, b) => a + b, 0n).toString()} particles` : loading ? "connecting…" : !protocol ? "TUNNEL unreachable" : protocol.paused ? "mining paused" : "next cycle opening…"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

interface ExperimentRow {
  cycleId: string;
  owner: string;
  seq: number;
  barrier: number;
  level: number;
  count: number;
  transmissionPpb: number;
  successes: number | null;
  rewardTokens: string | null;
  status: string;
  signature: string;
}

/** EXPERIMENT ARCHIVE — recent settled attempts from the indexer. */
export function ArchivePreview() {
  const res = useIndexed<{ rows: ExperimentRow[]; total: number }>("/api/experiments?pageSize=8&status=settled", 15_000);
  const rows = res.data?.data?.rows ?? [];
  return (
    <section className="mx-auto max-w-[1400px] px-4 py-28 sm:px-6" aria-labelledby="archive-title">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeading eyebrow="07 / Experiment archive" title={<span id="archive-title">Every attempt, on the record.</span>}>
          Settled experiments with their barrier, energy, probability and outcome. Each one can be recomputed from the cycle&apos;s public randomness.
        </SectionHeading>
        <ButtonLink href="/history" variant="secondary">
          Full archive <Arrow />
        </ButtonLink>
      </div>
      <div className="panel mt-10 overflow-x-auto">
        {res.data && !res.data.available ? (
          <div className="p-4">
            <Unavailable what="The experiment archive" />
          </div>
        ) : rows.length === 0 ? (
          <Empty title={res.loading ? "Loading experiments…" : "No settled experiments yet"}>Experiments appear here once their cycle has been settled.</Empty>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Experiment", "Wallet", "Barrier", "Energy", "Probability", "Outcome", "Reward"].map((h) => (
                  <th key={h} className="label px-4 py-3 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.cycleId}-${r.owner}-${r.seq}`} className="border-b border-line-soft last:border-0 hover:bg-panel-2/50">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link href={`/history/${r.cycleId}/${r.owner}/${r.seq}`} className="text-fg-2 hover:text-cyan">
                      C{r.cycleId}·{r.seq}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{shortKey(r.owner)}</td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: BARRIER_META[r.barrier].color }}>
                    {BARRIER_META[r.barrier].short}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {r.count} × {LEVEL_LABELS[r.level]}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{formatPpb(r.transmissionPpb)}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {r.successes == null ? "—" : r.successes > 0 ? <span className="text-flare">{r.successes} tunneled</span> : <span className="text-amber">reflected</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{r.rewardTokens != null ? formatTunnel(BigInt(r.rewardTokens)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

/** FINAL CTA */
export function FinalCta() {
  return (
    <section className="relative overflow-hidden border-t border-line-soft" aria-labelledby="cta-title">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_80%_at_50%_100%,rgba(0,217,255,0.12),transparent_70%)]" />
      <div className="grid-backdrop absolute inset-0 opacity-40" />
      <div className="relative mx-auto flex max-w-[1400px] flex-col items-center px-4 py-32 text-center sm:px-6 sm:py-40">
        <div className="eyebrow">TUNNEL / QUANTUM EXPERIMENT 001</div>
        <h2 id="cta-title" className="display mt-6 text-[clamp(40px,7vw,96px)]">
          The barrier isn&apos;t
          <br />
          <span className="bg-[linear-gradient(95deg,#EAFBFF,#00D9FF_55%,#885BFF)] bg-clip-text text-transparent">the limit.</span>
        </h2>
        <p className="mt-6 max-w-md text-muted">Free energy every cycle. Real physics. Verifiable outcomes.</p>
        <ButtonLink href="/accelerator" variant="energy" size="lg" className="mt-10 font-mono uppercase">
          Enter the accelerator <Arrow />
        </ButtonLink>
      </div>
    </section>
  );
}
