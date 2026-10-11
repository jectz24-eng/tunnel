"use client";

import { transmission } from "@tunnel/sdk";
import { useState } from "react";
import { useQuality } from "@/lib/quality";
import { WaveCanvas } from "../physics/WaveCanvas";
import { SectionHeading, cx } from "../ui";

const V0 = 2;
const A = 1.3;

/** THE PHENOMENON — classical vs quantum, with a live wavefunction. */
export function Phenomenon() {
  const q = useQuality();
  const [ratio, setRatio] = useState(0.55);
  const [view, setView] = useState<"quantum" | "classical">("quantum");
  const e = ratio * V0;
  const T = transmission(e, V0, A);
  const classical = ratio >= 1 ? 1 : 0;

  return (
    <section className="relative mx-auto max-w-[1400px] px-4 py-28 sm:px-6 sm:py-36" aria-labelledby="phenomenon">
      <div className="grid items-center gap-14 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <SectionHeading eyebrow="01 / The phenomenon" title={<span id="phenomenon">Matter doesn&apos;t always follow the rules.</span>}>
            A ball rolled at a hill it can&apos;t climb rolls back. Every time. A quantum particle is described by a wave, and part of that wave leaks
            into the barrier, decays, and emerges on the other side. The particle has a real, calculable probability of appearing where classical
            physics says it never can.
          </SectionHeading>
          <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line">
            <div className="bg-panel p-5">
              <dt className="label">Classical prediction</dt>
              <dd className="mt-3 font-mono text-[28px] tabular text-fg-2">{(classical * 100).toFixed(0)}%</dd>
              <dd className="mt-1 text-xs text-muted">{ratio < 1 ? "not enough energy to cross" : "energy above the barrier"}</dd>
            </div>
            <div className="bg-panel p-5">
              <dt className="label text-cyan">Quantum prediction</dt>
              <dd className="mt-3 font-mono text-[28px] tabular text-cyan glow-text">{(T * 100).toFixed(2)}%</dd>
              <dd className="mt-1 text-xs text-muted">transmission probability T</dd>
            </div>
          </dl>
          <p className="mt-6 max-w-lg text-sm leading-relaxed text-muted">
            The same relationship sets the odds in TUNNEL: every barrier&apos;s height V₀ and width a, together with the particle energy you allocate,
            fix a tunneling probability before any randomness is drawn.
          </p>
        </div>

        <div className="panel brackets overflow-hidden">
          <div className="flex items-center justify-between border-b border-line-soft px-5 py-3">
            <div className="label">Live wavefunction · ψ(x)</div>
            <div className="flex gap-1 rounded-lg border border-line p-0.5" role="tablist" aria-label="Model">
              {(["quantum", "classical"] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={cx("rounded-md px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em]", view === v ? "bg-panel-2 text-fg" : "text-muted hover:text-fg")}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="relative h-[300px] sm:h-[340px]">
            {view === "quantum" ? (
              <WaveCanvas e={e} v0={V0} a={A} className="absolute inset-0 h-full w-full" reducedMotion={q.reducedMotion} energyMax={V0 * 1.6} />
            ) : (
              <ClassicalView ratio={ratio} />
            )}
          </div>
          <div className="border-t border-line-soft px-5 py-4">
            <div className="flex items-center justify-between">
              <label htmlFor="phen-e" className="label">
                Particle energy E / V₀
              </label>
              <span className="font-mono text-sm tabular text-fg">{ratio.toFixed(2)}</span>
            </div>
            <input
              id="phen-e"
              type="range"
              min={0.05}
              max={1.5}
              step={0.01}
              value={ratio}
              onChange={(ev) => setRatio(Number(ev.target.value))}
              className="slider mt-2"
              style={{ ["--pct" as string]: `${((ratio - 0.05) / 1.45) * 100}%` }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function ClassicalView({ ratio }: { ratio: number }) {
  const over = ratio >= 1;
  return (
    <svg viewBox="0 0 600 340" className="absolute inset-0 h-full w-full" role="img" aria-label="Classical particle at a barrier">
      <rect x="270" y={340 - 26 - 180} width="70" height="180" fill="rgba(136,91,255,0.14)" stroke="rgba(136,91,255,0.8)" />
      <line x1="0" x2="600" y1="314" y2="314" stroke="rgba(129,144,159,0.35)" />
      <line x1="0" x2="600" y1={314 - ratio * 180} y2={314 - ratio * 180} stroke="rgba(129,144,159,0.6)" strokeDasharray="4 5" />
      <circle cx={over ? 470 : 230} cy={314 - ratio * 180 - 10} r="9" fill={over ? "#EAFBFF" : "#F0A64B"} />
      <path d={over ? "M60 0 L470 0" : "M60 0 L230 0 M230 0 L120 0"} transform={`translate(0 ${314 - ratio * 180 - 30})`} stroke={over ? "#EAFBFF" : "#F0A64B"} strokeDasharray="2 6" />
      <text x="20" y="40" className="fill-[#81909f] font-mono text-[12px]">
        {over ? "E ≥ V₀: the particle passes over" : "E < V₀: always reflected (T = 0)"}
      </text>
    </svg>
  );
}
