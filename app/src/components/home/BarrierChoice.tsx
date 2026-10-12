"use client";

import { BARRIER_META, formatMilli, formatPpb, formatTunnel, transmission } from "@tunnel/sdk";
import Link from "next/link";
import { useProtocolConfig } from "@/lib/protocol";
import { Arrow, Badge, SectionHeading } from "../ui";

/** CHOOSE YOUR BARRIER — the three difficulties with their real configuration. */
export function BarrierChoice() {
  const cfg = useProtocolConfig();
  return (
    <section className="mx-auto max-w-[1400px] px-4 py-28 sm:px-6 sm:py-36" aria-labelledby="barriers-title">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeading eyebrow="04 / Choose your barrier" title={<span id="barriers-title">Three walls. One equation.</span>}>
          Higher barriers are harder to tunnel through and pay more per success. Rewards are calibrated to the probabilities, so the expected reward per
          unit of energy is the same at every energy level of a barrier: you choose the variance.
        </SectionHeading>
        <Badge tone={cfg.source === "chain" ? "cyan" : "amber"}>{cfg.source === "chain" ? "Live configuration" : "Launch parameters"}</Badge>
      </div>
      <div className="mt-14 grid gap-5 lg:grid-cols-3">
        {cfg.barriers.map((b, i) => {
          const meta = BARRIER_META[i];
          const probs = cfg.odds.transmissionPpb[i];
          const rewards = cfg.odds.reward[i];
          const v0 = b.heightMilli / 1000;
          const a = b.widthMilli / 1000;
          return (
            <article key={i} className="panel brackets group relative overflow-hidden p-6 transition-transform duration-500 hover:-translate-y-1">
              <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full opacity-25 blur-3xl transition-opacity group-hover:opacity-40" style={{ background: meta.color }} />
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] tracking-[0.2em]" style={{ color: meta.color }}>
                  BARRIER {meta.numeral}
                </span>
                <span className="font-mono text-[11px] text-faint">premium {(b.rewardPremiumBps / 100).toFixed(0)}%</span>
              </div>
              <h3 className="mt-4 text-[28px] font-semibold tracking-tight">{meta.short} BARRIER</h3>
              <BarrierGlyph v0={v0} a={a} color={meta.color} levels={cfg.levels.map((l) => l.energyBps / 10_000)} />
              <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line-soft pt-5 text-sm">
                <div>
                  <dt className="label">Height V₀ · width a</dt>
                  <dd className="mt-1.5 font-mono tabular">
                    {formatMilli(b.heightMilli, 2)} · {formatMilli(b.widthMilli, 2)}
                  </dd>
                </div>
                <div>
                  <dt className="label">Tunneling probability</dt>
                  <dd className="mt-1.5 font-mono tabular" style={{ color: meta.color }}>
                    {formatPpb(probs[0], 1)} – {formatPpb(probs[probs.length - 1], 1)}
                  </dd>
                </div>
                <div>
                  <dt className="label">Reward per success</dt>
                  <dd className="mt-1.5 font-mono tabular">
                    {formatTunnel(rewards[rewards.length - 1], 1)} – {formatTunnel(rewards[0], 1)}
                  </dd>
                </div>
                <div>
                  <dt className="label">Character</dt>
                  <dd className="mt-1.5 text-fg-2">{["Frequent, small", "Balanced", "Rare, large"][i]}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
      <div className="mt-8 flex justify-end">
        <Link href="/accelerator" className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.14em] text-cyan hover:text-flare">
          Configure particles in the accelerator <Arrow />
        </Link>
      </div>
    </section>
  );
}

/** Barrier silhouette with its transmission curve over the protocol energy range. */
function BarrierGlyph({ v0, a, color, levels }: { v0: number; a: number; color: string; levels: number[] }) {
  const W = 300;
  const H = 96;
  const pts = Array.from({ length: 60 }, (_, i) => {
    const r = 0.05 + (i / 59) * 0.9;
    return `${i ? "L" : "M"}${(r * W).toFixed(1)},${(H - 6 - transmission(r * v0, v0, a) * (H - 16)).toFixed(1)}`;
  }).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-5 h-24 w-full" aria-hidden="true">
      <path d={`M0 ${H - 6}H${W}`} stroke="#1a2532" />
      <path d={pts} fill="none" stroke={color} strokeWidth="1.8" style={{ filter: `drop-shadow(0 0 5px ${color}88)` }} />
      {levels.map((r, i) => (
        <circle key={i} cx={r * W} cy={H - 6 - transmission(r * v0, v0, a) * (H - 16)} r="3" fill="#05070B" stroke={color} strokeWidth="1.5" />
      ))}
    </svg>
  );
}
