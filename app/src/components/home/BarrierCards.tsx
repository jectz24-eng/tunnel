"use client";

import { BARRIER_META, DEFAULT_PARAMS, formatBps } from "@tunnel/sdk";
import { useProtocol } from "@/lib/chain";

const WIDTHS = [3, 8, 16];

export function BarrierCards() {
  const protocol = useProtocol();
  const barriers = protocol.data?.params.barriers ?? DEFAULT_PARAMS.barriers;
  const live = !!protocol.data;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {barriers.map((b, i) => {
        const m = BARRIER_META[i];
        return (
          <div key={i} className="panel group relative overflow-hidden p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-mono text-[11px] tracking-[0.16em]" style={{ color: m.color }}>
                  BARRIER {m.numeral}
                </div>
                <div className="mt-1 text-[15px] font-medium">{m.name}</div>
              </div>
              <svg width="64" height="48" viewBox="0 0 64 48" aria-hidden="true">
                <defs>
                  <linearGradient id={`bc${i}`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor={m.color} stopOpacity="0" />
                    <stop offset="0.5" stopColor={m.color} stopOpacity="0.9" />
                    <stop offset="1" stopColor={m.color} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <rect x={32 - WIDTHS[i] / 2} y="2" width={WIDTHS[i]} height="44" fill={`url(#bc${i})`} opacity="0.55" />
                <path
                  d={`M2 24 Q8 14 14 24 T26 24 L${32 - WIDTHS[i] / 2} 24`}
                  stroke={m.color}
                  strokeWidth="1.3"
                  fill="none"
                  opacity="0.9"
                />
                <path
                  d={`M${32 + WIDTHS[i] / 2} 24 Q${38 + WIDTHS[i] / 2} ${24 - 10 * Math.sqrt(b.transmissionBps / 10_000)} ${44 + WIDTHS[i] / 2} 24 T62 24`}
                  stroke="#45E6B0"
                  strokeWidth="1.3"
                  fill="none"
                  opacity={0.35 + 0.6 * Math.sqrt(b.transmissionBps / 10_000)}
                />
              </svg>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-4">
              <div>
                <div className="label">Transmission</div>
                <div className="mt-1.5 font-mono text-2xl tabular">{formatBps(b.transmissionBps)}</div>
              </div>
              <div>
                <div className="label">Reward weight</div>
                <div className="mt-1.5 font-mono text-2xl tabular">{b.rewardWeight}×</div>
              </div>
            </div>
            <div className="mt-5 h-1 overflow-hidden rounded-full bg-bg-2">
              <div className="h-full rounded-full" style={{ width: `${b.transmissionBps / 100}%`, background: m.color, boxShadow: `0 0 12px ${m.color}` }} />
            </div>
            <div className="mt-3 font-mono text-[10.5px] text-faint">
              expected weight / particle = {((b.transmissionBps / 10_000) * b.rewardWeight).toFixed(2)} · {live ? "onchain config" : "launch config"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
