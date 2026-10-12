"use client";

import { BARRIER_META, ELECTRON_ENERGY_UNIT_EV, LEVEL_LABELS, formatPpb, solveBarrier, transmission } from "@tunnel/sdk";
import { useMemo, useState } from "react";
import { WaveCanvas } from "@/components/physics/WaveCanvas";
import { TransmissionChart } from "@/components/physics/TransmissionChart";
import { Badge, Panel, PanelHeader, Unavailable, cx } from "@/components/ui";
import { useIndexed } from "@/lib/api";
import { useProtocolConfig } from "@/lib/protocol";
import { useQuality } from "@/lib/quality";

interface Rate {
  barrier: number;
  level: number;
  transmissionPpb: number;
  experiments: number;
  particles: number;
  successes: number;
}

function Slider({ id, label, value, min, max, step, onChange, unit, color }: { id: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; unit?: string; color?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="label">
          {label}
        </label>
        <span className="font-mono text-sm tabular">
          {value.toFixed(step < 0.01 ? 3 : 2)}
          {unit && <span className="text-faint"> {unit}</span>}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider mt-2"
        style={{ ["--pct" as string]: `${((value - min) / (max - min)) * 100}%`, ["--track-fill" as string]: color ?? "#00D9FF" }}
      />
    </div>
  );
}

export function LaboratoryView() {
  const q = useQuality();
  const cfg = useProtocolConfig();
  const [v0, setV0] = useState(2);
  const [a, setA] = useState(1.3);
  const [e, setE] = useState(1);
  const [components, setComponents] = useState(true);
  const [log, setLog] = useState(false);
  const [units, setUnits] = useState<"normalized" | "electron">("normalized");
  const sol = useMemo(() => solveBarrier(Math.max(1e-4, e), v0, a), [e, v0, a]);
  const T = transmission(e, v0, a);
  const kappa = e < v0 ? Math.sqrt(v0 - e) : 0;

  const fmtE = (x: number) => (units === "electron" ? `${(x * ELECTRON_ENERGY_UNIT_EV).toFixed(2)} eV` : x.toFixed(3));
  const fmtL = (x: number) => (units === "electron" ? `${(x * 0.1).toFixed(3)} nm` : x.toFixed(3));

  const preset = (i: number, l: number) => {
    const b = cfg.barriers[i];
    const nv0 = b.heightMilli / 1000;
    setV0(nv0);
    setA(b.widthMilli / 1000);
    setE((nv0 * cfg.levels[l].energyBps) / 10_000);
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* controls */}
        <Panel brackets className="h-fit">
          <PanelHeader index="01" title="Experiment controls" />
          <div className="space-y-6 p-5">
            <Slider id="lab-e" label="Particle energy E" value={e} min={0.01} max={Math.max(6, v0 * 1.8)} step={0.005} onChange={setE} color="#00D9FF" />
            <Slider id="lab-v0" label="Barrier height V₀" value={v0} min={0.1} max={10} step={0.01} onChange={(v) => setV0(v)} color="#885BFF" />
            <Slider id="lab-a" label="Barrier width a" value={a} min={0.1} max={4} step={0.01} onChange={setA} color="#2864FF" />
            <div>
              <div className="label mb-2">Protocol presets</div>
              <div className="grid grid-cols-3 gap-1.5">
                {cfg.barriers.map((_, i) => (
                  <button key={i} onClick={() => preset(i, 2)} className="rounded-lg border border-line px-2 py-2 font-mono text-[10.5px] tracking-[0.12em] hover:border-muted/50" style={{ color: BARRIER_META[i].color }}>
                    {BARRIER_META[i].short}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-faint">Sets V₀ and a to the {cfg.source === "chain" ? "live" : "launch"} barrier, at energy level E3.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Toggle on={components} onClick={() => setComponents((c) => !c)}>
                Wave components
              </Toggle>
              <Toggle on={units === "electron"} onClick={() => setUnits((u) => (u === "electron" ? "normalized" : "electron"))}>
                Electron units
              </Toggle>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-px border-t border-line-soft bg-line-soft">
            {[
              ["Transmission T", T < 1e-4 ? T.toExponential(3) : `${(T * 100).toFixed(3)}%`, "#EAFBFF"],
              ["Reflection R", `${(sol.R * 100).toFixed(3)}%`, "#F0A64B"],
              ["E / V₀", (e / v0).toFixed(3)],
              ["κa", e < v0 ? (kappa * a).toFixed(3) : "—"],
              ["E", fmtE(e)],
              ["V₀ · a", `${fmtE(v0)} · ${fmtL(a)}`],
            ].map(([k, v, c]) => (
              <div key={k} className="bg-panel px-5 py-3.5">
                <dt className="label">{k}</dt>
                <dd className="mt-1 font-mono text-[15px] tabular" style={c ? { color: c } : undefined}>
                  {v}
                </dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-line-soft px-5 py-3 text-[11px] leading-relaxed text-faint">
            Check: |r|² + |t|² = {(sol.R + sol.T).toFixed(12)}. The wave solver and the closed-form T are independent methods; they agree to ~1e-12.
          </div>
        </Panel>

        <div className="grid min-w-0 gap-5">
          {/* wavefunction */}
          <Panel brackets className="overflow-hidden">
            <PanelHeader
              index="02"
              title="Wavefunction ψ(x) · stationary scattering state"
              right={
                <div className="hidden gap-3 font-mono text-[10.5px] sm:flex">
                  {components ? (
                    <>
                      <Legend c="#2864FF">incident</Legend>
                      <Legend c="#F0A64B">reflected</Legend>
                      <Legend c="#00D9FF">inside</Legend>
                      <Legend c="#EAFBFF">transmitted</Legend>
                    </>
                  ) : (
                    <Legend c="#00D9FF">Re ψ</Legend>
                  )}
                  <Legend c="rgba(234,251,255,0.5)">|ψ|</Legend>
                </div>
              }
            />
            <div className="relative h-[320px] sm:h-[380px]">
              <WaveCanvas e={e} v0={v0} a={a} components={components} reducedMotion={q.reducedMotion} className="absolute inset-0 h-full w-full" />
            </div>
          </Panel>

          {/* T(E) */}
          <Panel className="overflow-hidden">
            <PanelHeader
              index="03"
              title="Transmission probability vs energy"
              right={
                <div className="flex gap-1 rounded-lg border border-line p-0.5">
                  {[false, true].map((v) => (
                    <button key={String(v)} onClick={() => setLog(v)} aria-pressed={log === v} className={cx("rounded-md px-2.5 py-1 font-mono text-[10.5px] uppercase", log === v ? "bg-panel-2 text-fg" : "text-muted hover:text-fg")}>
                      {v ? "log" : "linear"}
                    </button>
                  ))}
                </div>
              }
            />
            <div className="p-4">
              <TransmissionChart curves={[{ v0, a, color: "#00D9FF", label: "this barrier" }]} current={{ ratio: e / v0 }} maxRatio={2.5} log={log} height={280} />
            </div>
          </Panel>
        </div>
      </div>

      {/* explanation + records */}
      <div className="mt-5 grid gap-5">
        <Panel className="p-6">
          <div className="label mb-4">04 · What you are looking at</div>
          <div className="prose-doc">
            <p>
              A particle of energy E approaches a rectangular barrier of height V₀ and width a. Solving the time-independent Schrödinger equation in three
              regions and matching ψ and dψ/dx at both edges gives the reflected amplitude r, the transmitted amplitude t and the two decaying/growing
              components inside the barrier.
            </p>
            <p>
              Below the barrier (E &lt; V₀) the wave inside is real-exponential with decay constant κ = √(2m(V₀−E))/ħ. What survives to the far edge
              continues as a travelling wave with probability T = |t|². Above the barrier, T oscillates and reaches exactly 1 at resonances where κa = nπ.
            </p>
            <p>
              Units are normalized so that ħ²/2m = 1. With &ldquo;Electron units&rdquo; on, lengths are shown in nm (1 unit = 1 Å) and energies in eV
              (1 unit ≈ {ELECTRON_ENERGY_UNIT_EV.toFixed(2)} eV). This is a simplified one-dimensional, time-independent model; real devices involve
              more physics.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={cx("rounded-lg border px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em]", on ? "border-cyan/50 bg-cyan/[0.07] text-cyan" : "border-line text-muted hover:text-fg")}>
      {children}
    </button>
  );
}

function Legend({ c, children }: { c: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-muted">
      <span className="h-0.5 w-3 rounded" style={{ background: c }} />
      {children}
    </span>
  );
}
