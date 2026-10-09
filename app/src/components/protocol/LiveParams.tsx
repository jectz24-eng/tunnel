"use client";

import { BARRIER_META, DEFAULT_PARAMS, formatBps, formatSol, formatTunnel, scheduledEmission } from "@tunnel/sdk";
import { useProtocol } from "@/lib/chain";
import { appConfig, explorerAddress } from "@/lib/config";

export function LiveParams() {
  const protocol = useProtocol();
  const p = protocol.data?.params ?? DEFAULT_PARAMS;
  const live = !!protocol.data;
  const next = protocol.data?.nextRoundId ?? 0n;
  const rows: [string, string][] = [
    ["Particle cost", `${formatSol(p.particleCostLamports)} SOL`],
    ["Round duration", `${p.roundDurationSecs} s`],
    ["Protocol fee", formatBps(p.protocolFeeBps)],
    ["Max particles / wallet / round", String(p.maxParticlesPerPosition)],
    ["Randomness timeout", `${p.randomnessTimeoutSecs} s`],
    ["Emission (next round)", `${formatTunnel(scheduledEmission(p, next))} $TUNNEL`],
    ["Emission decay", `×${(p.emissionDecayBps / 10_000).toFixed(4)} every ${p.emissionEpochRounds.toLocaleString()} rounds`],
  ];
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-line-soft px-5 py-3">
        <span className="label">Current parameters</span>
        <span className="font-mono text-[10.5px] text-faint">
          {live ? (
            <a href={explorerAddress(protocol.data!.address.toBase58())} target="_blank" rel="noreferrer" className="hover:text-cyan">
              onchain Protocol account ↗
            </a>
          ) : (
            `launch configuration · not yet deployed on ${appConfig.cluster}`
          )}
        </span>
      </div>
      <div className="grid gap-px bg-line-soft md:grid-cols-[1fr_1.3fr]">
        <div className="bg-panel p-5">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left">
                <th className="label pb-2 font-normal">Barrier</th>
                <th className="label pb-2 font-normal">Transmission</th>
                <th className="label pb-2 text-right font-normal">Weight</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular">
              {p.barriers.map((b, i) => (
                <tr key={i} className="border-t border-line-soft">
                  <td className="py-2.5" style={{ color: BARRIER_META[i].color }}>
                    {BARRIER_META[i].numeral} · {BARRIER_META[i].name}
                  </td>
                  <td className="py-2.5 text-fg">{formatBps(b.transmissionBps)}</td>
                  <td className="py-2.5 text-right text-fg">{b.rewardWeight}×</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 bg-panel p-5 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 border-b border-line-soft py-2 text-[13px] sm:block sm:border-0 sm:py-1.5">
              <dt className="text-muted">{k}</dt>
              <dd className="font-mono tabular text-fg sm:mt-0.5">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
