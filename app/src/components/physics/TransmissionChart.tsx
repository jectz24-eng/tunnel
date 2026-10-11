"use client";

import { transmission } from "@tunnel/sdk";
import { useId, useMemo, useState } from "react";

export interface Marker {
  /** E/V₀ */
  ratio: number;
  label: string;
  color?: string;
}

export interface Curve {
  v0: number;
  a: number;
  color: string;
  label: string;
}

/**
 * T(E) for one or more rectangular barriers, x = E/V₀ from 0 to `maxRatio`
 * (values above 1 show over-barrier resonances). Linear or log scale.
 */
export function TransmissionChart({
  curves,
  current,
  markers = [],
  maxRatio = 1.6,
  log = false,
  height = 260,
  className,
}: {
  curves: Curve[];
  current?: { ratio: number; color?: string };
  markers?: Marker[];
  maxRatio?: number;
  log?: boolean;
  height?: number;
  className?: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 44, r: 14, t: 14, b: 30 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const minLog = -6;

  const yOf = (t: number) => {
    if (!log) return pad.t + ih * (1 - t);
    const lv = Math.max(minLog, Math.log10(Math.max(t, 1e-12)));
    return pad.t + ih * (lv / minLog);
  };
  const xOf = (r: number) => pad.l + (r / maxRatio) * iw;

  const paths = useMemo(
    () =>
      curves.map((c) => {
        const pts: string[] = [];
        const N = 320;
        for (let i = 1; i <= N; i++) {
          const r = (i / N) * maxRatio;
          const t = transmission(r * c.v0, c.v0, c.a);
          pts.push(`${i === 1 ? "M" : "L"}${xOf(r).toFixed(2)},${yOf(t).toFixed(2)}`);
        }
        return pts.join("");
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [curves, maxRatio, log, H],
  );

  const yTicks = log ? [0, -1, -2, -3, -4, -5, -6].map((p) => ({ v: 10 ** p, label: p === 0 ? "1" : `1e${p}` })) : [0, 0.25, 0.5, 0.75, 1].map((v) => ({ v, label: `${v * 100}%` }));
  const xTicks = Array.from({ length: Math.floor(maxRatio / 0.25) + 1 }, (_, i) => i * 0.25);

  const hv = hover != null ? curves.map((c) => ({ c, t: transmission(hover * c.v0, c.v0, c.a) })) : null;

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={`Transmission probability versus particle energy for ${curves.map((c) => c.label).join(", ")}`}
        onPointerMove={(ev) => {
          const r = (ev.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((ev.clientX - r.left) / r.width) * W;
          const ratio = ((x - pad.l) / iw) * maxRatio;
          setHover(ratio > 0 && ratio <= maxRatio ? ratio : null);
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          {curves.map((c, i) => (
            <linearGradient key={i} id={`${id}-g${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={c.color} stopOpacity="0.18" />
              <stop offset="1" stopColor={c.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {/* barrier top: E = V₀ */}
        <rect x={xOf(1)} y={pad.t} width={xOf(maxRatio) - xOf(1)} height={ih} fill="rgba(136,91,255,0.04)" />
        <line x1={xOf(1)} x2={xOf(1)} y1={pad.t} y2={pad.t + ih} stroke="rgba(136,91,255,0.5)" strokeDasharray="3 4" />
        <text x={xOf(1) + 6} y={pad.t + 12} className="fill-[#9b80ff] font-mono text-[10px]">
          E = V₀
        </text>
        {yTicks.map((t) => (
          <g key={t.label}>
            <line x1={pad.l} x2={W - pad.r} y1={yOf(t.v)} y2={yOf(t.v)} stroke="rgba(26,37,50,0.9)" />
            <text x={pad.l - 8} y={yOf(t.v) + 3.5} textAnchor="end" className="fill-[#4c5a69] font-mono text-[10px]">
              {t.label}
            </text>
          </g>
        ))}
        {xTicks.map((r) => (
          <text key={r} x={xOf(r)} y={H - 10} textAnchor="middle" className="fill-[#4c5a69] font-mono text-[10px]">
            {r.toFixed(2)}
          </text>
        ))}
        <text x={W - pad.r} y={H - 10} textAnchor="end" className="fill-[#81909f] font-mono text-[10px]">
          E / V₀ →
        </text>
        {markers.map((m, i) => (
          <g key={i}>
            <line x1={xOf(m.ratio)} x2={xOf(m.ratio)} y1={pad.t + ih - 8} y2={pad.t + ih} stroke={m.color ?? "#81909f"} strokeWidth="1.5" />
            <text x={xOf(m.ratio)} y={pad.t + ih - 12} textAnchor="middle" className="font-mono text-[9px]" fill={m.color ?? "#81909f"}>
              {m.label}
            </text>
          </g>
        ))}
        {curves.map((c, i) => (
          <g key={i}>
            {!log && <path d={`${paths[i]}L${xOf(maxRatio)},${pad.t + ih}L${xOf(0)},${pad.t + ih}Z`} fill={`url(#${id}-g${i})`} />}
            <path d={paths[i]} fill="none" stroke={c.color} strokeWidth="1.8" style={{ filter: `drop-shadow(0 0 4px ${c.color}66)` }} />
          </g>
        ))}
        {current && curves[0] && (
          <g>
            <line x1={xOf(current.ratio)} x2={xOf(current.ratio)} y1={pad.t} y2={pad.t + ih} stroke={current.color ?? "#00D9FF"} strokeOpacity="0.35" />
            <circle cx={xOf(current.ratio)} cy={yOf(transmission(current.ratio * curves[0].v0, curves[0].v0, curves[0].a))} r="4.5" fill="#05070B" stroke={current.color ?? "#00D9FF"} strokeWidth="2" />
          </g>
        )}
        {hover != null && hv && (
          <g pointerEvents="none">
            <line x1={xOf(hover)} x2={xOf(hover)} y1={pad.t} y2={pad.t + ih} stroke="rgba(243,247,250,0.25)" />
            {hv.map(({ c, t }, i) => (
              <circle key={i} cx={xOf(hover)} cy={yOf(t)} r="3" fill={c.color} />
            ))}
            <g transform={`translate(${Math.min(xOf(hover) + 10, W - 170)}, ${pad.t + 8})`}>
              <rect width="160" height={18 + hv.length * 15} rx="6" fill="rgba(10,15,23,0.92)" stroke="rgba(26,37,50,1)" />
              <text x="10" y="14" className="fill-[#81909f] font-mono text-[10px]">
                E/V₀ = {hover.toFixed(3)}
              </text>
              {hv.map(({ c, t }, i) => (
                <text key={i} x="10" y={29 + i * 15} className="font-mono text-[10px]" fill={c.color}>
                  {c.label}: {t < 1e-4 ? t.toExponential(2) : `${(t * 100).toFixed(2)}%`}
                </text>
              ))}
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}
