"use client";

import { BARRIER_META, formatBps, formatSol, formatTunnel, splitFee, type PositionAccount, type RoundAccount } from "@tunnel/sdk";
import { Val } from "../ui";

export function RoundPanel({ round, position }: { round: RoundAccount | null; position: PositionAccount | null }) {
  const totalParticles = round ? round.particles.reduce((a, b) => a + b, 0n) : 0n;
  const pool = round ? splitFee(round.totalLamports, round.protocolFeeBps) : null;
  const mine = position ? position.particles.reduce((a, b) => a + b, 0) : 0;

  return (
    <div>
      <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
        <span className="label">Round statistics</span>
        <span className="font-mono text-[10.5px] text-faint">onchain</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 p-4">
        <Metric label="Pool" value={round ? `${formatSol(round.totalLamports, 3)} SOL` : null} />
        <Metric label="Participants" value={round ? round.participants.toLocaleString() : null} />
        <Metric label="Distributable (95%)" value={pool ? `${formatSol(pool.distributable, 3)}` : null} />
        <Metric label="$TUNNEL emission" value={round ? formatTunnel(round.emissionBudget, 0) : null} />
      </div>

      <div className="border-t border-line-soft px-4 py-3">
        <div className="label mb-3">Barrier probabilities · snapshot</div>
        <div className="space-y-3">
          {(round?.barriers ?? []).map((b, i) => {
            const n = round!.particles[i];
            const share = totalParticles > 0n ? Number((n * 1000n) / totalParticles) / 10 : 0;
            const m = BARRIER_META[i];
            return (
              <div key={i}>
                <div className="flex items-baseline justify-between font-mono text-[11.5px]">
                  <span style={{ color: m.color }}>{m.numeral}</span>
                  <span className="text-muted">
                    T {formatBps(b.transmissionBps)} · w {b.rewardWeight}× · <span className="text-fg-2">{n.toString()}</span> particles
                  </span>
                </div>
                <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-bg-2">
                  <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${share}%`, background: m.color, boxShadow: `0 0 10px ${m.color}` }} />
                </div>
              </div>
            );
          })}
          {!round && <div className="text-xs text-muted">No round accepting deposits.</div>}
        </div>
      </div>

      <div className="border-t border-line-soft px-4 py-3">
        <div className="label mb-2">Your position</div>
        {position ? (
          <div className="font-mono text-[12px] text-fg-2">
            {position.particles.map((n, i) =>
              n ? (
                <span key={i} className="mr-3" style={{ color: BARRIER_META[i].color }}>
                  {BARRIER_META[i].numeral} × {n}
                </span>
              ) : null,
            )}
            <div className="mt-1 text-muted">
              {mine} particles · {formatSol(position.lamports)} SOL committed
            </div>
          </div>
        ) : (
          <div className="text-[12px] text-muted">No particles in this round.</div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <div className="label truncate">{label}</div>
      <div className="mt-1 truncate font-mono text-[15px] tabular">
        <Val v={value} />
      </div>
    </div>
  );
}
