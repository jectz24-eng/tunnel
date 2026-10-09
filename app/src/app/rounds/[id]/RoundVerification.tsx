"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  BARRIER_META,
  computePayout,
  fetchRound,
  fetchRoundPositions,
  formatBps,
  formatSol,
  formatTunnel,
  oraoRandomnessPda,
  particleOutcomes,
  shortKey,
  splitFee,
  successThreshold,
  toHex,
} from "@tunnel/sdk";
import { useMemo, useState } from "react";
import { Badge, Empty, ExternalLink, Panel, Skeleton, cx } from "@/components/ui";
import { useIndexed } from "@/lib/api";
import { useChainClock } from "@/lib/chain";
import { appConfig, explorerAddress } from "@/lib/config";
import { usePoll } from "@/lib/poll";
import { displayStatus, outcomeLabel, statusTone } from "@/lib/round";

interface SettledEvent {
  owner: string;
  particles: number[];
  successes: number[];
  success_weight: string;
  signature: string;
}

export function RoundVerification({ id }: { id: string }) {
  const { connection } = useConnection();
  const { now } = useChainClock(1000);
  const roundId = BigInt(id);
  const round = usePoll(`round:${id}`, () => fetchRound(connection, roundId, appConfig.programId), 5_000);
  const positions = usePoll(round.data ? `roundPositions:${id}:${round.data.positionsSettled}:${round.data.claims}` : null, () => fetchRoundPositions(connection, roundId, appConfig.programId), 15_000);
  const idx = useIndexed<{ settled: SettledEvent[] }>(`/api/rounds/${id}`, 15_000);
  const [open, setOpen] = useState<string | null>(null);

  const r = round.data;
  const hasRandomness = !!r && r.randomness.some((b) => b !== 0);

  // Merge: live position accounts (unclaimed) + PositionSettled events (claimed & closed).
  const entries = useMemo(() => {
    if (!r) return [];
    const map = new Map<string, { owner: string; particles: number[]; recorded: number[] | null; recordedWeight: bigint | null; lamports: bigint | null; source: string }>();
    for (const e of idx.data?.data?.settled ?? []) {
      map.set(e.owner, { owner: e.owner, particles: e.particles.map(Number), recorded: e.successes.map(Number), recordedWeight: BigInt(e.success_weight), lamports: null, source: "event" });
    }
    for (const p of positions.data ?? []) {
      const o = p.owner.toBase58();
      map.set(o, {
        owner: o,
        particles: p.particles,
        recorded: p.settled ? p.successes : (map.get(o)?.recorded ?? null),
        recordedWeight: p.settled ? p.successWeight : (map.get(o)?.recordedWeight ?? null),
        lamports: p.lamports,
        source: "account",
      });
    }
    return [...map.values()].map((e) => {
      const outs = hasRandomness
        ? [0, 1, 2].flatMap((b) => particleOutcomes(r.randomness, r.id, new PublicKey(e.owner).toBytes(), b, e.particles[b], r.barriers[b].transmissionBps))
        : [];
      const expected = [0, 1, 2].map((b) => outs.filter((o) => o.barrier === b && o.success).length);
      const weight = expected.reduce((a, s, b) => a + BigInt(s) * BigInt(r.barriers[b].rewardWeight), 0n);
      const matches = e.recorded ? expected.every((s, i) => s === e.recorded![i]) && (e.recordedWeight == null || e.recordedWeight === weight) : null;
      return { ...e, outs, expected, weight, matches };
    });
  }, [r, positions.data, idx.data, hasRandomness]);

  if (round.loading && !r) return <Panel className="mt-8 p-8"><Skeleton className="h-6 w-60" /></Panel>;
  if (!r) return <Panel className="mt-8"><Empty title={`Round ${id} does not exist on ${appConfig.cluster}`} /></Panel>;

  const st = displayStatus(r, now);
  const { fee } = splitFee(r.totalLamports, r.protocolFeeBps);
  const coverage = entries.reduce((a, e) => a + e.particles.reduce((x, y) => x + y, 0), 0);
  const totalParticles = r.particles.reduce((a, b) => a + Number(b), 0);
  const checked = entries.filter((e) => e.matches !== null);
  const allMatch = checked.length > 0 && checked.every((e) => e.matches) && (r.status !== "settled" || r.outcome === "empty" || r.feeLamports === fee);

  return (
    <div className="mt-8 space-y-4">
      <Panel>
        <div className="flex flex-wrap items-center gap-x-10 gap-y-3 px-5 py-4">
          <div>
            <div className="label">State</div>
            <div className="mt-1.5">
              <Badge tone={statusTone[st]}>{st}</Badge>
            </div>
          </div>
          <div>
            <div className="label">Outcome</div>
            <div className="mt-1.5 text-[13px]">{outcomeLabel[r.outcome]}</div>
          </div>
          <div>
            <div className="label">Pool</div>
            <div className="mt-1 font-mono text-[13px]">{formatSol(r.totalLamports)} SOL</div>
          </div>
          <div>
            <div className="label">Fee</div>
            <div className="mt-1 font-mono text-[13px]">{formatSol(r.feeLamports)} SOL</div>
          </div>
          <div>
            <div className="label">$TUNNEL budget</div>
            <div className="mt-1 font-mono text-[13px]">{formatTunnel(r.emissionBudget)}</div>
          </div>
          <div className="ml-auto">
            {checked.length > 0 ? (
              allMatch ? (
                <Badge tone="green">
                  <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1.5 5.5 4 8l4.5-6" stroke="currentColor" strokeWidth="1.4" fill="none" /></svg>
                  Verified · {checked.length} positions
                </Badge>
              ) : (
                <Badge tone="red">Mismatch detected</Badge>
              )
            ) : (
              <Badge>{hasRandomness ? "Awaiting settlement records" : "Randomness not yet revealed"}</Badge>
            )}
          </div>
        </div>
      </Panel>

      <Panel className="p-5">
        <div className="label mb-3">Randomness</div>
        <dl className="space-y-3 font-mono text-[11.5px]">
          <Field k="VRF seed" v={r.vrfSeed.some((b) => b) ? toHex(r.vrfSeed) : "— (fixed when the round closes)"} />
          <Field
            k="ORAO request account"
            v={r.vrfSeed.some((b) => b) ? <ExternalLink href={explorerAddress(oraoRandomnessPda(r.vrfSeed).toBase58())}>{oraoRandomnessPda(r.vrfSeed).toBase58()}</ExternalLink> : "—"}
          />
          <Field k="Randomness (64 bytes)" v={hasRandomness ? toHex(r.randomness) : "— (not yet revealed)"} />
          <Field k="Round account" v={<ExternalLink href={explorerAddress(r.address.toBase58())}>{r.address.toBase58()}</ExternalLink>} />
        </dl>
        <div className="mt-4 rounded-lg border border-line-soft bg-bg-2 p-3 font-mono text-[11px] leading-relaxed text-muted">
          draw = u64_le(sha256(&quot;TUNNEL/particle/v1&quot; ‖ randomness ‖ u64_le({r.id.toString()}) ‖ owner ‖ barrier ‖ u32_le(i))[0..8])
          <br />
          tunnels ⇔ draw &lt; ⌊bps · 2⁶⁴ / 10⁴⌋ ·{" "}
          {r.barriers.map((b, i) => (
            <span key={i} className="mr-2" style={{ color: BARRIER_META[i].color }}>
              {BARRIER_META[i].numeral}: {formatBps(b.transmissionBps)} → {successThreshold(b.transmissionBps).toString(16)}
            </span>
          ))}
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line-soft px-5 py-3">
          <span className="label">Positions · recomputed in your browser</span>
          <span className="font-mono text-[10.5px] text-faint">
            {coverage} / {totalParticles} particles covered
          </span>
        </div>
        {entries.length === 0 ? (
          <Empty title="No positions found">{r.participants === 0 ? "Nobody participated in this round." : "Position records are loading or the indexer is unavailable."}</Empty>
        ) : (
          <ul>
            {entries.map((e) => {
              const payout =
                r.status === "settled" || r.status === "failed"
                  ? computePayout({
                      outcome: r.outcome,
                      distributableLamports: r.distributableLamports,
                      totalLamports: r.totalLamports,
                      totalSuccessWeight: r.totalSuccessWeight,
                      emissionBudget: r.emissionBudget,
                      positionLamports: e.lamports ?? BigInt(e.particles.reduce((a, b) => a + b, 0)) * r.particleCostLamports,
                      positionSuccessWeight: e.weight,
                    })
                  : null;
              return (
                <li key={e.owner} className="border-t border-line-soft first:border-t-0">
                  <button onClick={() => setOpen(open === e.owner ? null : e.owner)} className="flex w-full flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3 text-left font-mono text-[12px] hover:bg-panel-2">
                    <span className="w-28 text-fg">{shortKey(e.owner, 5)}</span>
                    <span className="text-muted">
                      {e.particles.map((n, i) => (n ? <span key={i} className="mr-2" style={{ color: BARRIER_META[i].color }}>{BARRIER_META[i].numeral}:{n}</span> : null))}
                    </span>
                    <span className="text-green">{hasRandomness ? `${e.expected.reduce((a, b) => a + b, 0)} tunnelled · w ${e.weight}` : "pending"}</span>
                    {payout && <span className="text-fg-2">{formatSol(payout.lamports)} SOL · {formatTunnel(payout.tokens)} $TUNNEL</span>}
                    <span className="ml-auto">
                      {e.matches === null ? <span className="text-faint">not settled</span> : e.matches ? <span className="text-green">matches program</span> : <span className="text-red">MISMATCH</span>}
                    </span>
                  </button>
                  {open === e.owner && hasRandomness && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-1 bg-bg-2 px-5 py-3">
                      {e.outs.map((o) => (
                        <div key={`${o.barrier}-${o.index}`} title={`draw 0x${o.draw.toString(16).padStart(16, "0")}`} className={cx("rounded border px-1.5 py-1 font-mono text-[10px]", o.success ? "border-green/30 text-green" : "border-line-soft text-faint")}>
                          {BARRIER_META[o.barrier].numeral}·{o.index} {o.success ? "T" : "R"}
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[180px_1fr]">
      <dt className="font-sans text-[12px] text-muted">{k}</dt>
      <dd className="break-all text-fg-2">{v}</dd>
    </div>
  );
}
