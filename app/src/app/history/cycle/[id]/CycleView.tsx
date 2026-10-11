"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { BARRIER_META, LEVEL_LABELS, fetchCycle, formatMilli, formatPpb, formatTunnel, oraoRandomnessPda, shortKey, toHex, verifyOdds, type CycleAccount } from "@tunnel/sdk";
import Link from "next/link";
import { Badge, Dot, Empty, Panel, PanelHeader, Unavailable, Val } from "@/components/ui";
import { useIndexed } from "@/lib/api";
import { useChainClock } from "@/lib/chain";
import { appConfig, explorerAddress } from "@/lib/config";
import { displayStatus, outcomeLabel, statusTone, useCycleVerification } from "@/lib/cycle";
import { usePoll } from "@/lib/poll";
import type { ExperimentRow } from "../../HistoryView";
import { STATUS_TONE } from "../../HistoryView";

interface PositionRow {
  owner: string;
  particles: number[];
  successes: number[];
  energyUsed: number;
  experiments: number;
  settled: boolean;
  claimed: boolean;
  nominalReward: string;
  tokensPaid: string;
  expectedTokens: string | null;
  claimSignature: string | null;
}

/** One cycle: onchain state, randomness proof, in-browser verification, and every position and experiment. */
export function CycleView({ id }: { id: string }) {
  const { connection } = useConnection();
  const { now } = useChainClock(1000);
  const cycle = usePoll<CycleAccount | null>(`cycle:${id}`, () => fetchCycle(connection, BigInt(id), appConfig.programId), 5_000);
  const verification = useCycleVerification(cycle.data ?? null);
  const indexed = useIndexed<{ positions: PositionRow[]; experiments: ExperimentRow[] } | null>(`/api/cycles/${id}`, 10_000);
  const c = cycle.data;

  if (cycle.loading && c === undefined) return <Empty title="Reading cycle from chain…" />;
  if (!c) return <Empty title={`Cycle #${id} does not exist on ${appConfig.cluster}`}>It may not have been opened yet.</Empty>;

  const st = displayStatus(c, now);
  const v = verification.data?.verification;
  const oddsOk = verifyOdds(c);
  const revealed = c.randomness.some((b) => b !== 0);
  const positions = indexed.data?.data?.positions ?? [];
  const experiments = indexed.data?.data?.experiments ?? [];

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid min-w-0 gap-5">
        <Panel brackets>
          <PanelHeader title={`Cycle #${c.id}`} right={<Badge tone={statusTone[st]}>{st}</Badge>} />
          <dl className="grid grid-cols-2 gap-px bg-line-soft sm:grid-cols-4">
            {[
              ["Outcome", outcomeLabel[c.outcome]],
              ["Participants", c.participants],
              ["Experiments", c.experiments],
              ["Energy used", c.energyUsed.toString()],
              ["Tunnels L / M / H", c.successes.join(" / ")],
              ["Particles L / M / H", c.particles.join(" / ")],
              ["Emission budget", formatTunnel(c.emissionBudget)],
              ["Allocated · claimed", `${formatTunnel(c.tokensAllocated)} · ${formatTunnel(c.tokensClaimed)}`],
            ].map(([k, val]) => (
              <div key={String(k)} className="bg-panel px-5 py-4">
                <dt className="label">{k}</dt>
                <dd className="mt-1.5 font-mono text-sm tabular">{val}</dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-line-soft px-5 py-3 font-mono text-[11px] text-muted">
            {new Date(c.openTs * 1000).toLocaleString()} → {new Date(c.closeTs * 1000).toLocaleString()}
            {c.totalNominal > c.emissionBudget && <span className="ml-3 text-amber">capped: nominal {formatTunnel(c.totalNominal)} scaled to budget</span>}
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Odds snapshot · derived from barrier physics" right={<Badge tone={oddsOk ? "cyan" : "red"}>{oddsOk ? "Physics check passed" : "Mismatch"}</Badge>} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-line-soft text-left">
                  <th className="label px-5 py-2.5 font-normal">Barrier (V₀ · a)</th>
                  {c.levels.map((l, i) => (
                    <th key={i} className="label px-3 py-2.5 font-normal">
                      {LEVEL_LABELS[i]} · {(l.energyBps / 100).toFixed(0)}% · ⚡{l.cost}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {c.barriers.map((b, i) => (
                  <tr key={i} className="border-b border-line-soft last:border-0">
                    <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs" style={{ color: BARRIER_META[i].color }}>
                      {BARRIER_META[i].short} ({formatMilli(b.heightMilli, 2)} · {formatMilli(b.widthMilli, 2)})
                    </td>
                    {c.odds.transmissionPpb[i].map((p, l) => (
                      <td key={l} className="px-3 py-2.5 font-mono text-xs">
                        {formatPpb(p)}
                        <div className="text-[10px] text-faint">{formatTunnel(c.odds.reward[i][l], 2)}</div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Positions" right={<span className="font-mono text-[10.5px] text-faint">indexed · claimed positions are rebuilt from events</span>} />
          {indexed.data && !indexed.data.available ? (
            <div className="p-4">
              <Unavailable what="Position history" />
            </div>
          ) : positions.length === 0 ? (
            <Empty title="No positions in this cycle" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line-soft text-left">
                    {["Wallet", "Experiments", "Particles", "Tunneled", "Payout", "Claim"].map((h) => (
                      <th key={h} className="label px-5 py-2.5 font-normal">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => {
                    const verified = v?.positions.find((x) => x.owner === p.owner);
                    return (
                      <tr key={p.owner} className="border-b border-line-soft last:border-0">
                        <td className="px-5 py-2.5 font-mono text-xs">
                          <Link className="text-fg-2 hover:text-cyan" href={`/profile/${p.owner}`}>
                            {shortKey(p.owner, 6)}
                          </Link>
                          {verified && <span className={verified.matches ? "ml-2 text-cyan" : "ml-2 text-red"}>{verified.matches ? "✓" : "✗"}</span>}
                        </td>
                        <td className="px-5 py-2.5 font-mono text-xs">{p.experiments}</td>
                        <td className="px-5 py-2.5 font-mono text-xs">{p.particles.reduce((a, b) => a + b, 0)}</td>
                        <td className="px-5 py-2.5 font-mono text-xs">{p.settled ? p.successes.reduce((a, b) => a + b, 0) : "—"}</td>
                        <td className="px-5 py-2.5 font-mono text-xs">{p.claimed ? formatTunnel(BigInt(p.tokensPaid)) : p.expectedTokens != null ? formatTunnel(BigInt(p.expectedTokens)) : "—"}</td>
                        <td className="px-5 py-2.5 font-mono text-xs">{p.claimed ? <span className="text-ion">claimed</span> : <span className="text-faint">open</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Experiments" />
          {experiments.length === 0 ? (
            <Empty title={indexed.loading ? "Loading…" : "No experiments indexed for this cycle"} />
          ) : (
            <ul className="divide-y divide-line-soft">
              {experiments.map((e) => (
                <li key={`${e.owner}-${e.seq}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Link href={`/history/${e.cycleId}/${e.owner}/${e.seq}`} className="font-mono text-xs text-fg-2 hover:text-cyan">
                    EXP-{e.cycleId}-{e.owner.slice(0, 4)}-{e.seq}
                  </Link>
                  <span className="font-mono text-xs" style={{ color: BARRIER_META[e.barrier].color }}>
                    {BARRIER_META[e.barrier].short} · {e.count}×{LEVEL_LABELS[e.level]}
                  </span>
                  <ParticleBits bits={e.outcomeBits} count={e.count} />
                  <Badge tone={STATUS_TONE[e.status] ?? "neutral"} className="ml-auto">
                    {e.status.replace("_", " ")}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid h-fit gap-5">
        <Panel brackets>
          <PanelHeader title="Independent verification" />
          <div className="space-y-3 p-5 text-sm">
            <Check ok={oddsOk} label="Odds table = physics model applied to the snapshotted barriers" />
            <Check ok={revealed ? (v ? v.positions.every((p) => p.matches) : null) : null} label={revealed ? `Every open position's outcomes recomputed from the randomness (${v?.positions.length ?? "…"} checked)` : "Randomness not revealed yet"} />
            <Check ok={c.status === "settled" ? (v ? v.totalNominalMatches : null) : null} label="Σ nominal rewards matches the program total (when no position has closed)" />
            <p className="pt-2 text-[11.5px] leading-relaxed text-muted">
              Verification runs in your browser with the open-source SDK against the onchain Cycle and Position accounts. Claimed positions are closed
              onchain; their settled values remain in the program&apos;s event log.
            </p>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Randomness proof · ORAO VRF" />
          <dl className="space-y-3 p-5 font-mono text-[11px]">
            <div>
              <dt className="label">VRF seed (fixed at close)</dt>
              <dd className="mt-1 break-all text-fg-2">{c.vrfSeed.some((b) => b) ? toHex(c.vrfSeed) : "—"}</dd>
            </div>
            <div>
              <dt className="label">ORAO request account</dt>
              <dd className="mt-1 break-all">
                {c.vrfSeed.some((b) => b) ? (
                  <a className="text-cyan hover:underline" href={explorerAddress(oraoRandomnessPda(c.vrfSeed).toBase58())} target="_blank" rel="noreferrer">
                    {oraoRandomnessPda(c.vrfSeed).toBase58()}
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt className="label">Randomness (64 bytes)</dt>
              <dd className="mt-1 break-all text-fg-2">
                <Val v={revealed ? toHex(c.randomness) : null} />
              </dd>
            </div>
            <div>
              <dt className="label">Cycle account</dt>
              <dd className="mt-1 break-all">
                <a className="text-cyan hover:underline" href={explorerAddress(c.address.toBase58())} target="_blank" rel="noreferrer">
                  {c.address.toBase58()}
                </a>
              </dd>
            </div>
          </dl>
        </Panel>
      </div>
    </div>
  );
}

function Check({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-1.5">
        <Dot color={ok == null ? "#4c5a69" : ok ? "#00D9FF" : "#FF6B7D"} />
      </span>
      <span className={ok === false ? "text-red" : "text-fg-2"}>{label}</span>
    </div>
  );
}

export function ParticleBits({ bits, count }: { bits: string | null; count: number }) {
  if (!bits) return <span className="font-mono text-[10.5px] text-faint">{count} particles · not revealed</span>;
  return (
    <span className="flex flex-wrap gap-0.5" aria-label={`${bits.split("").filter((b) => b === "1").length} of ${count} tunneled`}>
      {bits.split("").map((b, i) => (
        <span key={i} className="size-2 rounded-[2px]" style={{ background: b === "1" ? "#EAFBFF" : "rgba(240,166,75,0.35)", boxShadow: b === "1" ? "0 0 6px #00D9FF" : undefined }} />
      ))}
    </span>
  );
}
