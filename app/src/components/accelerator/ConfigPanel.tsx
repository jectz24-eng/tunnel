"use client";

import { BARRIER_META, LEVEL_LABELS, atLeastOneProbability, expectedReward, formatMilli, formatPpb, formatTunnel, type EnergyLevel, type OddsTable, type BarrierConfig } from "@tunnel/sdk";
import { play } from "@/lib/sound";
import { cx } from "../ui";

export interface Config {
  barrier: number;
  level: number;
  count: number;
}

/**
 * PARTICLE CONFIGURATION. Every number shown is derived from the cycle's
 * onchain snapshot (odds table, energy costs, allowance); nothing is hardcoded.
 */
export function ConfigPanel({
  config,
  onChange,
  barriers,
  levels,
  odds,
  energyLeft,
  energyPerCycle,
  disabled,
}: {
  config: Config;
  onChange: (c: Config) => void;
  barriers: BarrierConfig[];
  levels: EnergyLevel[];
  odds: OddsTable;
  energyLeft: number | null;
  energyPerCycle: number;
  disabled?: boolean;
}) {
  const { barrier: b, level: l, count } = config;
  const cost = levels[l].cost;
  const left = energyLeft ?? energyPerCycle;
  const maxCount = Math.max(0, Math.floor(left / cost));
  const ppb = odds.transmissionPpb[b][l];
  const reward = odds.reward[b][l];
  const meta = BARRIER_META[b];
  const n = maxCount === 0 ? 0 : Math.min(count, maxCount);
  const used = n * cost;
  const pctLeft = (left / energyPerCycle) * 100;
  const pctAfter = (Math.max(0, left - used) / energyPerCycle) * 100;

  const set = (patch: Partial<Config>) => {
    play("tick");
    const next = { ...config, ...patch };
    const max = Math.max(1, Math.floor(left / levels[next.level].cost));
    onChange({ ...next, count: Math.min(Math.max(1, next.count), max) });
  };

  return (
    <div className="flex flex-col">
      {/* barrier difficulty */}
      <fieldset className="border-b border-line-soft px-5 py-5" disabled={disabled}>
        <legend className="label mb-3 flex w-full items-center justify-between">
          <span>Barrier difficulty</span>
          <span className="normal-case tracking-normal text-faint">V₀ · a</span>
        </legend>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Barrier difficulty">
          {barriers.map((bar, i) => {
            const m = BARRIER_META[i];
            const active = i === b;
            return (
              <button
                key={i}
                role="radio"
                aria-checked={active}
                onClick={() => set({ barrier: i })}
                className={cx("relative rounded-xl border px-2 py-3 text-left transition-colors", active ? "bg-panel-2" : "border-line hover:border-muted/40")}
                style={active ? { borderColor: `${m.color}88`, boxShadow: `0 0 24px -8px ${m.color}` } : undefined}
              >
                <div className="font-mono text-[10px] tracking-[0.16em]" style={{ color: m.color }}>
                  {m.short}
                </div>
                <svg viewBox="0 0 40 24" className="mt-2 h-6 w-full" aria-hidden="true">
                  <path d={`M0 23H14V${23 - (bar.heightMilli / 4000) * 20}H${14 + (bar.widthMilli / 1500) * 10}V23H40`} fill="none" stroke={m.color} strokeWidth="1.4" opacity={active ? 1 : 0.6} />
                </svg>
                <div className="mt-1 font-mono text-[10px] text-muted">
                  {formatMilli(bar.heightMilli, 1)} · {formatMilli(bar.widthMilli, 1)}
                </div>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* particle energy */}
      <fieldset className="border-b border-line-soft px-5 py-5" disabled={disabled}>
        <legend className="label mb-3 flex w-full items-center justify-between">
          <span>Particle energy</span>
          <span className="normal-case tracking-normal text-faint">E / V₀ · cost</span>
        </legend>
        <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Particle energy">
          {levels.map((lv, i) => {
            const active = i === l;
            return (
              <button
                key={i}
                role="radio"
                aria-checked={active}
                onClick={() => set({ level: i })}
                className={cx("rounded-lg border px-1 py-2.5 text-center transition-colors", active ? "border-cyan/60 bg-cyan/[0.07] text-fg" : "border-line text-muted hover:border-muted/40 hover:text-fg")}
              >
                <div className="font-mono text-[11px]">{LEVEL_LABELS[i]}</div>
                <div className="mt-1.5 flex h-8 w-full items-end justify-center">
                  <div className={cx("w-1.5 rounded-sm", active ? "bg-cyan shadow-[0_0_8px_#00D9FF]" : "bg-muted/50")} style={{ height: `${(lv.energyBps / 10_000) * 100}%` }} />
                </div>
                <div className="mt-1 font-mono text-[9.5px] text-faint">{(lv.energyBps / 100).toFixed(0)}%</div>
                <div className="font-mono text-[9.5px]">⚡{lv.cost}</div>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* number of particles */}
      <fieldset className="border-b border-line-soft px-5 py-5" disabled={disabled || maxCount === 0}>
        <div className="flex items-center justify-between">
          <label htmlFor="count" className="label">
            Number of particles
          </label>
          <div className="flex items-center gap-1">
            <button className="size-7 rounded-md border border-line text-fg-2 hover:border-muted/50 disabled:opacity-40" onClick={() => set({ count: n - 1 })} disabled={n <= 1} aria-label="Fewer particles">
              −
            </button>
            <input
              id="count"
              type="number"
              min={1}
              max={Math.max(1, maxCount)}
              value={n}
              onChange={(e) => set({ count: Number(e.target.value) || 1 })}
              className="h-7 w-14 rounded-md border border-line bg-bg-2 text-center font-mono text-sm tabular"
            />
            <button className="size-7 rounded-md border border-line text-fg-2 hover:border-muted/50 disabled:opacity-40" onClick={() => set({ count: n + 1 })} disabled={n >= maxCount} aria-label="More particles">
              +
            </button>
          </div>
        </div>
        <input
          type="range"
          min={1}
          max={Math.max(1, maxCount)}
          value={n}
          onChange={(e) => set({ count: Number(e.target.value) })}
          className="slider mt-3"
          aria-label="Number of particles"
          style={{ ["--pct" as string]: `${maxCount > 1 ? ((n - 1) / (maxCount - 1)) * 100 : 100}%`, ["--track-fill" as string]: meta.color }}
        />
        <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
          <span>1</span>
          <span>max {maxCount}</span>
        </div>
      </fieldset>

      {/* energy meter */}
      <div className="border-b border-line-soft px-5 py-5">
        <div className="flex items-center justify-between">
          <span className="label">Available cycle energy</span>
          <span className="font-mono text-sm tabular">
            {left}
            <span className="text-faint"> / {energyPerCycle}</span>
          </span>
        </div>
        <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-line" role="meter" aria-valuemin={0} aria-valuemax={energyPerCycle} aria-valuenow={left} aria-label="Available cycle energy">
          <div className="absolute inset-y-0 left-0 rounded-full bg-cyan/30 transition-[width] duration-300" style={{ width: `${pctLeft}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,#2864FF,#00D9FF)] transition-[width] duration-300" style={{ width: `${pctAfter}%` }} />
        </div>
        <div className="mt-2 flex justify-between font-mono text-[10.5px] text-muted">
          <span>this deployment uses ⚡{used}</span>
          <span>{Math.max(0, left - used)} left after</span>
        </div>
      </div>

      {/* estimates */}
      <dl className="grid grid-cols-2 gap-px bg-line-soft">
        {[
          ["Tunneling probability", formatPpb(ppb), "per particle", meta.color],
          ["≥ 1 tunnels", n ? `${(atLeastOneProbability(ppb, n) * 100).toFixed(n > 1 ? 1 : 2)}%` : "—", n ? `${n} independent draw${n === 1 ? "" : "s"}` : "no energy left this cycle"],
          ["Reward per success", `${formatTunnel(reward)}`, "$TUNNEL, before cycle cap"],
          ["Expected reward", n ? `${formatTunnel(expectedReward(odds, b, l, n))}` : "—", n ? `potential up to ${formatTunnel(reward * BigInt(n), 1)}` : "refills next cycle"],
        ].map(([k, v, sub, c]) => (
          <div key={k} className="bg-panel px-5 py-4">
            <dt className="label">{k}</dt>
            <dd className="mt-1.5 font-mono text-[17px] tabular" style={c ? { color: c } : undefined}>
              {v}
            </dd>
            <dd className="mt-0.5 text-[11px] text-faint">{sub}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
