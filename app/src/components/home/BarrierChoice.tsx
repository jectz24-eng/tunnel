"use client";

import { DEFAULT_PARAMS, VOLATILITY, formatChance, formatMilli, formatMultiplier, transmission } from "@tunnel/sdk";
import Link from "next/link";
import { Arrow, SectionHeading } from "../ui";

const CHARACTER = ["Steady hits, tight swings", "One in five breaks through", "Rare. Massive."];

/** CHOOSE YOUR BARRIER — the three volatility levels and what they pay. */
export function BarrierChoice() {
  return (
    <section className="mx-auto max-w-[1400px] px-4 py-28 sm:px-6 sm:py-36" aria-labelledby="barriers-title">
      <SectionHeading eyebrow="04 / Choose your barrier" title={<span id="barriers-title">Three walls. Pick your volatility.</span>}>
        The taller the barrier, the rarer the tunnel and the bigger the hit. Every particle that makes it through pays its multiplier on the energy you
        put behind it.
      </SectionHeading>
      <div className="mt-14 grid gap-5 lg:grid-cols-3">
        {VOLATILITY.map((v, i) => {
          const b = DEFAULT_PARAMS.barriers[i];
          return (
            <article key={v.key} className="panel brackets group relative overflow-hidden p-6 transition-transform duration-500 hover:-translate-y-1">
              <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full opacity-25 blur-3xl transition-opacity group-hover:opacity-40" style={{ background: v.color }} />
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] tracking-[0.2em]" style={{ color: v.color }}>
                  {v.name.toUpperCase()}
                </span>
                <span className="font-mono text-[11px] text-faint">
                  V₀ {formatMilli(b.heightMilli, 1)} · a {formatMilli(b.widthMilli, 1)}
                </span>
              </div>
              <h3 className="mt-4 text-[28px] font-semibold tracking-tight">{v.short} BARRIER</h3>
              <BarrierGlyph v0={b.heightMilli / 1000} a={b.widthMilli / 1000} color={v.color} />
              <dl className="mt-6 grid grid-cols-3 gap-x-4 border-t border-line-soft pt-5 text-sm">
                <div>
                  <dt className="label">Win chance</dt>
                  <dd className="mt-1.5 font-mono text-lg tabular" style={{ color: v.color }}>
                    {formatChance(v.ppb)}
                  </dd>
                </div>
                <div>
                  <dt className="label">Pays</dt>
                  <dd className="mt-1.5 font-mono text-lg tabular">{formatMultiplier(v.multiplierBps)}</dd>
                </div>
                <div>
                  <dt className="label">Feel</dt>
                  <dd className="mt-1.5 text-[13px] leading-snug text-fg-2">{CHARACTER[i]}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
      <div className="mt-8 flex flex-wrap justify-end gap-6">
        <Link href="/laboratory" className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.14em] text-muted hover:text-fg">
          Practice for free
        </Link>
        <Link href="/accelerator" className="inline-flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.14em] text-cyan hover:text-flare">
          Fire in the accelerator <Arrow />
        </Link>
      </div>
    </section>
  );
}

/** Barrier silhouette with its quantum transmission curve. */
function BarrierGlyph({ v0, a, color }: { v0: number; a: number; color: string }) {
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
    </svg>
  );
}
