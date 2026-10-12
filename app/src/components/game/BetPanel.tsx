"use client";

import { DEFAULT_PARAMS, LEVEL_LABELS, MAX_PARTICLES_PER_BET, VOLATILITY, formatChance, formatMultiplier, formatTunnel, parseTunnel, tunnelToPlain } from "@tunnel/sdk";
import { useEffect, useState } from "react";
import { BET_PRESETS } from "@/lib/game";
import { play } from "@/lib/sound";
import { cx } from "../ui";

export interface BetConfig {
  volatility: number;
  amount: bigint;
  count: number;
}

/** Never rounds a near-certainty up to 100% (or a long shot down to 0%). */
function pctAtLeastOne(p: number, n: number) {
  const v = 1 - Math.pow(1 - p, n);
  if (v > 0.999) return "> 99.9%";
  if (v < 0.001) return "< 0.1%";
  return `${(v * 100).toFixed(1)}%`;
}

/**
 * Bet configuration: barrier = volatility, particle energy = bet size,
 * particle count = how many bets fire at once.
 */
export function BetPanel({
  config,
  onChange,
  minBet,
  maxBet,
  unit,
  disabled,
}: {
  config: BetConfig;
  onChange: (c: BetConfig) => void;
  minBet: bigint;
  maxBet: bigint;
  unit: string;
  disabled?: boolean;
}) {
  const { volatility: vi, amount, count } = config;
  const v = VOLATILITY[vi];
  const [text, setText] = useState(tunnelToPlain(amount));
  useEffect(() => setText(tunnelToPlain(amount)), [amount]);

  const set = (patch: Partial<BetConfig>) => {
    play("tick");
    onChange({ ...config, ...patch });
  };
  const clampAmount = (a: bigint) => (a < minBet ? minBet : a > maxBet ? maxBet : a);
  const stake = amount * BigInt(count);
  const maxReturn = (stake * BigInt(v.multiplierBps)) / 10_000n;
  const presets = BET_PRESETS.map((p) => clampAmount(p));
  const activePreset = presets.findIndex((p) => p === amount);

  return (
    <div className="flex flex-col">
      {/* volatility */}
      <fieldset className="border-b border-line-soft px-5 py-5" disabled={disabled}>
        <legend className="label mb-3 flex w-full items-center justify-between">
          <span>Barrier · volatility</span>
          <span className="normal-case tracking-normal text-faint">win chance · payout</span>
        </legend>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Volatility">
          {VOLATILITY.map((lv, i) => {
            const bar = DEFAULT_PARAMS.barriers[i];
            const active = i === vi;
            return (
              <button
                key={lv.key}
                role="radio"
                aria-checked={active}
                onClick={() => set({ volatility: i })}
                className={cx("relative rounded-xl border px-2.5 py-3 text-left transition-colors", active ? "bg-panel-2" : "border-line hover:border-muted/40")}
                style={active ? { borderColor: `${lv.color}88`, boxShadow: `0 0 24px -8px ${lv.color}` } : undefined}
              >
                <div className="font-mono text-[10px] tracking-[0.16em]" style={{ color: lv.color }}>
                  {lv.short}
                </div>
                <svg viewBox="0 0 40 24" className="mt-2 h-6 w-full" aria-hidden="true">
                  <path d={`M0 23H14V${23 - (bar.heightMilli / 4000) * 20}H${14 + (bar.widthMilli / 1500) * 10}V23H40`} fill="none" stroke={lv.color} strokeWidth="1.4" opacity={active ? 1 : 0.6} />
                </svg>
                <div className="mt-1.5 font-mono text-[13px] tabular text-fg">{formatMultiplier(lv.multiplierBps)}</div>
                <div className="font-mono text-[10px] text-muted">{formatChance(lv.ppb)} chance</div>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* bet size */}
      <fieldset className="border-b border-line-soft px-5 py-5" disabled={disabled}>
        <legend className="label mb-3 flex w-full items-center justify-between">
          <span>Particle energy · bet size</span>
          <span className="normal-case tracking-normal text-faint">per particle</span>
        </legend>
        <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Bet size presets">
          {presets.map((p, i) => {
            const active = i === activePreset;
            return (
              <button
                key={i}
                role="radio"
                aria-checked={active}
                onClick={() => set({ amount: p })}
                className={cx("rounded-lg border px-1 py-2.5 text-center transition-colors", active ? "border-cyan/60 bg-cyan/[0.07] text-fg" : "border-line text-muted hover:border-muted/40 hover:text-fg")}
              >
                <div className="font-mono text-[11px]">{LEVEL_LABELS[i]}</div>
                <div className="mt-1.5 flex h-7 w-full items-end justify-center">
                  <div className={cx("w-1.5 rounded-sm", active ? "bg-cyan shadow-[0_0_8px_#00D9FF]" : "bg-muted/50")} style={{ height: `${20 + i * 20}%` }} />
                </div>
                <div className="mt-1 font-mono text-[10px] tabular">{formatTunnel(p, 0)}</div>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="relative flex-1">
            <input
              aria-label="Bet size per particle"
              inputMode="decimal"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                const a = parseTunnel(e.target.value);
                if (a != null && a > 0n) onChange({ ...config, amount: a });
              }}
              onBlur={() => onChange({ ...config, amount: clampAmount(amount) })}
              className="h-10 w-full rounded-lg border border-line bg-bg-2 pl-3 pr-20 font-mono text-[15px] tabular"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[11px] text-muted">{unit}</span>
          </div>
          {[
            ["½", (a: bigint) => a / 2n],
            ["2×", (a: bigint) => a * 2n],
          ].map(([label, fn]) => (
            <button
              key={label as string}
              onClick={() => set({ amount: clampAmount((fn as (a: bigint) => bigint)(amount)) })}
              className="h-10 w-11 rounded-lg border border-line font-mono text-[12px] text-fg-2 hover:border-muted/50"
            >
              {label as string}
            </button>
          ))}
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-faint">
          <span>min {formatTunnel(minBet)}</span>
          <span>max {formatTunnel(maxBet, 0)}</span>
        </div>
      </fieldset>

      {/* particles */}
      <fieldset className="border-b border-line-soft px-5 py-5" disabled={disabled}>
        <div className="flex items-center justify-between">
          <label htmlFor="count" className="label">
            Particles · simultaneous bets
          </label>
          <div className="flex items-center gap-1">
            <button className="size-7 rounded-md border border-line text-fg-2 hover:border-muted/50 disabled:opacity-40" onClick={() => set({ count: count - 1 })} disabled={count <= 1} aria-label="Fewer particles">
              −
            </button>
            <input
              id="count"
              type="number"
              min={1}
              max={MAX_PARTICLES_PER_BET}
              value={count}
              onChange={(e) => onChange({ ...config, count: Math.min(MAX_PARTICLES_PER_BET, Math.max(1, Number(e.target.value) || 1)) })}
              className="h-7 w-14 rounded-md border border-line bg-bg-2 text-center font-mono text-sm tabular"
            />
            <button
              className="size-7 rounded-md border border-line text-fg-2 hover:border-muted/50 disabled:opacity-40"
              onClick={() => set({ count: count + 1 })}
              disabled={count >= MAX_PARTICLES_PER_BET}
              aria-label="More particles"
            >
              +
            </button>
          </div>
        </div>
        <input
          type="range"
          min={1}
          max={MAX_PARTICLES_PER_BET}
          value={count}
          onChange={(e) => onChange({ ...config, count: Number(e.target.value) })}
          className="slider mt-3"
          aria-label="Particles"
          style={{ ["--pct" as string]: `${((count - 1) / (MAX_PARTICLES_PER_BET - 1)) * 100}%`, ["--track-fill" as string]: v.color }}
        />
        <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
          <span>1</span>
          <span>{MAX_PARTICLES_PER_BET}</span>
        </div>
      </fieldset>

      {/* summary */}
      <dl className="grid grid-cols-2 gap-px bg-line-soft">
        {[
          ["Win chance", formatChance(v.ppb), "per particle", v.color],
          ["≥ 1 tunnels", pctAtLeastOne(v.ppb / 1e9, count), `${count} particle${count === 1 ? "" : "s"}`],
          ["Total bet", formatTunnel(stake), unit],
          ["Max win", formatTunnel(maxReturn), `${formatMultiplier(v.multiplierBps)} on every particle`],
        ].map(([k, val, sub, c]) => (
          <div key={k} className="bg-panel px-5 py-4">
            <dt className="label">{k}</dt>
            <dd className="mt-1.5 font-mono text-[17px] tabular" style={c ? { color: c } : undefined}>
              {val}
            </dd>
            <dd className="mt-0.5 text-[11px] text-faint">{sub}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
