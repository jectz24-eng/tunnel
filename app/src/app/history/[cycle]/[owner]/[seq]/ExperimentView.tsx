"use client";

import { BARRIER_META, LEVEL_LABELS, decodeBase58, formatMilli, formatPpb, formatTunnel, particleOutcomes, shortKey, transmissionPpb } from "@tunnel/sdk";
import Link from "next/link";
import { useMemo } from "react";
import { Badge, Dot, Empty, Panel, PanelHeader, Unavailable } from "@/components/ui";
import { WaveCanvas } from "@/components/physics/WaveCanvas";
import { useIndexed } from "@/lib/api";
import { useCycle } from "@/lib/chain";
import { useQuality } from "@/lib/quality";
import { ParticleBits } from "../../../cycle/[id]/CycleView";
import { STATUS_TONE, type ExperimentRow } from "../../../HistoryView";

/** One experiment: its record, its physics, and a particle-by-particle re-derivation from the cycle's randomness. */
export function ExperimentView({ cycle, owner, seq }: { cycle: string; owner: string; seq: string }) {
  const q = useQuality();
  const res = useIndexed<{ experiment: ExperimentRow & { message: string } } | null>(`/api/experiments/${cycle}/${owner}/${seq}`, 15_000);
  const chainCycle = useCycle(BigInt(cycle));
  const e = res.data?.data?.experiment;
  const c = chainCycle.data;

  const recomputed = useMemo(() => {
    if (!e || !c || !c.randomness) return null;
    return particleOutcomes(c.randomness, c.id, decodeBase58(e.owner), e.barrier, e.level, e.count, e.transmissionPpb, e.firstIndex);
  }, [e, c]);
  const bitsFromChain = recomputed?.map((o) => (o.success ? "1" : "0")).join("") ?? null;
  const matches = bitsFromChain != null && e?.outcomeBits != null ? bitsFromChain === e.outcomeBits : null;

  if (res.data && !res.data.available) return <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6"><Unavailable what="Experiment records" /></div>;
  if (!res.data) return <Empty title="Loading experiment…" />;
  if (!e) return <Empty title="Experiment not found" />;

  const meta = BARRIER_META[e.barrier];
  const v0 = e.heightMilli / 1000;
  const a = e.widthMilli / 1000;
  const en = (v0 * e.energyBps) / 10_000;
  const physicsPpb = transmissionPpb(e.heightMilli, e.widthMilli, e.energyBps);

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="grid min-w-0 gap-5">
        <Panel brackets>
          <PanelHeader title={`EXP-${e.cycleId}-${e.owner.slice(0, 4)}-${e.seq}`} right={<Badge tone={STATUS_TONE[e.status] ?? "neutral"}>{e.status.replace("_", " ")}</Badge>} />
          <dl className="grid grid-cols-2 gap-px bg-line-soft sm:grid-cols-3">
            {[
              ["Wallet", <Link key="w" className="hover:text-cyan" href={`/profile/${e.owner}`}>{shortKey(e.owner, 6)}</Link>],
              ["Cycle", <Link key="c" className="hover:text-cyan" href={`/history/cycle/${e.cycleId}`}>#{e.cycleId}</Link>],
              ["Time", new Date(e.createdAt).toLocaleString()],
              ["Barrier", <span key="b" style={{ color: meta.color }}>{meta.name}</span>],
              ["Particle energy", `${LEVEL_LABELS[e.level]} · E = ${en.toFixed(3)} (${(e.energyBps / 100).toFixed(0)}% of V₀)`],
              ["Particles · energy", `${e.count} · ⚡${e.energyCost}`],
              ["Barrier V₀ · a", `${formatMilli(e.heightMilli)} · ${formatMilli(e.widthMilli)}`],
              ["Calculated probability", formatPpb(e.transmissionPpb)],
              ["Reward per success", `${formatTunnel(BigInt(e.nominalReward))} $TUNNEL`],
              ["Outcome", e.successes == null ? "not revealed" : `${e.successes} / ${e.count} tunneled`],
              ["Reward", e.rewardTokens != null ? `${formatTunnel(BigInt(e.rewardTokens))} $TUNNEL` : "—"],
              ["Wallet signature", <span key="t" title={e.signature}>{e.signature.slice(0, 12)}…</span>],
            ].map(([k, val]) => (
              <div key={String(k)} className="bg-panel px-5 py-4">
                <dt className="label">{k}</dt>
                <dd className="mt-1.5 font-mono text-[13px]">{val}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel className="overflow-hidden">
          <PanelHeader title="This experiment's wavefunction" />
          <div className="relative h-[280px]">
            <WaveCanvas e={en} v0={v0} a={a} components reducedMotion={q.reducedMotion} className="absolute inset-0 h-full w-full" />
          </div>
        </Panel>
      </div>
      <div className="grid h-fit gap-5">
        <Panel brackets>
          <PanelHeader title="Particle outcomes" />
          <div className="space-y-4 p-5">
            <ParticleBits bits={e.outcomeBits} count={e.count} />
            <div className="space-y-2.5 text-sm">
              <Row ok={physicsPpb != null && Math.abs(physicsPpb - e.transmissionPpb) <= 1} label="Probability = physics model of this barrier" />
              <Row ok={matches} label={matches == null ? "Waiting for the cycle's randomness" : `Re-derived ${e.count} draws from the cycle randomness (indices ${e.firstIndex}–${e.firstIndex + e.count - 1})`} />
            </div>
            {recomputed && (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-line-soft bg-bg-2/60">
                <table className="w-full font-mono text-[10.5px]">
                  <tbody>
                    {recomputed.map((o) => (
                      <tr key={o.index} className="border-b border-line-soft last:border-0">
                        <td className="px-3 py-1.5 text-faint">#{o.index}</td>
                        <td className="px-3 py-1.5 text-muted">{o.draw.toString(16).padStart(16, "0")}</td>
                        <td className={`px-3 py-1.5 text-right ${o.success ? "text-flare" : "text-amber"}`}>{o.success ? "tunneled" : "reflected"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-faint">
              Each draw is the first 8 bytes of sha256(&quot;TUNNEL/particle/v3&quot; ‖ randomness ‖ cycle ‖ wallet ‖ barrier ‖ level ‖ index); a particle
              tunnels when the draw is below ⌊p·2⁶⁴⌋. {c?.randomnessHex && <>Randomness: {c.randomnessHex.slice(0, 18)}…</>}
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Row({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-1.5">
        <Dot color={ok == null ? "#4c5a69" : ok ? "#00D9FF" : "#FF6B7D"} />
      </span>
      <span className={ok === false ? "text-red" : "text-fg-2"}>{label}</span>
    </div>
  );
}
