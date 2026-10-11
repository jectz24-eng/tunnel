"use client";

import { BARRIER_META, LEVEL_LABELS } from "@tunnel/sdk";
import { useState } from "react";
import { useProtocolConfig } from "@/lib/protocol";
import { TransmissionChart } from "../physics/TransmissionChart";
import { Arrow, ButtonLink, SectionHeading, cx } from "../ui";

/** THE PHYSICS — interactive probability visualization for the three protocol barriers. */
export function PhysicsSection() {
  const cfg = useProtocolConfig();
  const [log, setLog] = useState(false);
  const curves = cfg.barriers.map((b, i) => ({ v0: b.heightMilli / 1000, a: b.widthMilli / 1000, color: BARRIER_META[i].chart, label: BARRIER_META[i].short }));
  return (
    <section className="mx-auto max-w-[1400px] px-4 py-28 sm:px-6 sm:py-32" aria-labelledby="physics-title">
      <div className="grid gap-14 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
        <div>
          <SectionHeading eyebrow="05 / The physics" title={<span id="physics-title">The odds are an equation, not a setting.</span>}>
            For a particle of energy E meeting a rectangular barrier of height V₀ and width a, quantum mechanics gives the transmission probability exactly.
            The TUNNEL program evaluates this formula itself whenever parameters change, and stores the result. Nobody can set the odds directly.
          </SectionHeading>
          <div className="panel mt-8 p-5">
            <div className="label">Transmission coefficient, E &lt; V₀</div>
            <div className="mt-4 overflow-x-auto font-mono text-[15px] text-fg sm:text-[17px]">
              T = [ 1 + V₀² sinh²(κa) / 4E(V₀ − E) ]<sup>−1</sup>
            </div>
            <div className="mt-2 font-mono text-[13px] text-muted">κ = √(2m(V₀ − E)) / ħ</div>
            <p className="mt-4 text-xs leading-relaxed text-muted">
              Normalized units with ħ²/2m = 1. For an electron, 1 length unit = 1 Å and 1 energy unit ≈ 3.81 eV. The probability falls roughly
              exponentially with width × √(V₀ − E): a little more barrier makes tunneling much rarer.
            </p>
          </div>
          <div className="mt-6">
            <ButtonLink href="/laboratory" variant="secondary">
              Open the laboratory <Arrow />
            </ButtonLink>
          </div>
        </div>
        <div className="panel brackets p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-4">
              {curves.map((c) => (
                <span key={c.label} className="flex items-center gap-2 font-mono text-[11px] tracking-[0.1em] text-fg-2">
                  <span className="h-0.5 w-5 rounded" style={{ background: c.color }} /> {c.label}
                </span>
              ))}
            </div>
            <div className="flex gap-1 rounded-lg border border-line p-0.5">
              {[false, true].map((v) => (
                <button key={String(v)} onClick={() => setLog(v)} aria-pressed={log === v} className={cx("rounded-md px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em]", log === v ? "bg-panel-2 text-fg" : "text-muted hover:text-fg")}>
                  {v ? "log" : "linear"}
                </button>
              ))}
            </div>
          </div>
          <TransmissionChart
            className="mt-4"
            curves={curves}
            log={log}
            maxRatio={1.5}
            height={300}
            markers={cfg.levels.map((l, i) => ({ ratio: l.energyBps / 10_000, label: LEVEL_LABELS[i], color: "#81909F" }))}
          />
          <p className="mt-3 text-xs text-muted">
            Ticks E1–E5 mark the particle energies the protocol offers (as a fraction of each barrier&apos;s height). Hover to read exact values.
          </p>
        </div>
      </div>
    </section>
  );
}
