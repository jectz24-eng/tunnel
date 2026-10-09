"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  ACCOUNT_SIZES,
  BARRIER_META,
  TunnelInstructions,
  formatBps,
  formatSol,
  type PositionAccount,
  type RoundAccount,
} from "@tunnel/sdk";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useBalances } from "@/lib/chain";
import { appConfig, explorerTx } from "@/lib/config";
import { usePoll } from "@/lib/poll";
import { formatCountdown } from "@/lib/round";
import { useSendTx } from "@/lib/tx";
import { Button, cx } from "../ui";
import { WalletPicker } from "../WalletButton";

const PRESETS = [1, 5, 10, 25, 50];
const BASE_FEE_LAMPORTS = 5_000n;

interface Props {
  round: RoundAccount | null;
  position: PositionAccount | null;
  now: number;
  paused: boolean;
  deployed: boolean;
}

export function AllocationPanel({ round, position, now, paused, deployed }: Props) {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const balances = useBalances(publicKey ?? null);
  const [barrier, setBarrier] = useState(0);
  const [count, setCount] = useState(5);
  const [confirming, setConfirming] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const rent = usePoll("rent:position", async () => BigInt(await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZES.position)), 600_000);

  const existing = position ? position.particles.reduce((a, b) => a + b, 0) : 0;
  const maxAllowed = round ? Math.max(0, round.maxParticlesPerPosition - existing) : 0;
  const cost = round?.particleCostLamports ?? 10_000_000n;
  const total = cost * BigInt(count);
  const positionRent = position ? 0n : (rent.data ?? 0n);
  const networkFee = BASE_FEE_LAMPORTS;
  const required = total + positionRent + networkFee;
  const b = round?.barriers[barrier];
  const remaining = round ? round.closeTs - now : 0;

  useEffect(() => {
    if (count > maxAllowed && maxAllowed > 0) setCount(maxAllowed);
  }, [maxAllowed, count]);

  const blocker = useMemo(() => {
    if (!deployed) return "Program not deployed on this cluster";
    if (!appConfig.depositsEnabled) return "Deposits disabled on this network";
    if (paused) return "Deposits paused by protocol admin";
    if (!round) return "Waiting for the next round to open";
    if (remaining <= 0) return "Round deposit window has ended";
    if (count < 1) return "Choose at least one particle";
    if (count > maxAllowed) return maxAllowed === 0 ? "Position limit reached for this round" : `At most ${maxAllowed} more particles this round`;
    if (balances.data && balances.data.lamports < required) return "Insufficient SOL balance";
    return null;
  }, [deployed, paused, round, remaining, count, maxAllowed, balances.data, required]);

  return (
    <div className="flex flex-col">
      <div className="border-b border-line-soft px-4 py-3">
        <span className="label">Particle allocation</span>
      </div>

      <div className="p-4">
        <div className="label mb-2">Energy barrier</div>
        <div role="radiogroup" aria-label="Energy barrier" className="grid grid-cols-3 gap-2">
          {(round?.barriers ?? []).length === 0 && <div className="col-span-3 rounded-lg border border-line-soft p-3 text-xs text-muted">No open round</div>}
          {round?.barriers.map((bp, i) => {
            const m = BARRIER_META[i];
            const active = i === barrier;
            return (
              <button
                key={i}
                role="radio"
                aria-checked={active}
                onClick={() => setBarrier(i)}
                className={cx(
                  "relative rounded-[10px] border px-2.5 pb-2.5 pt-2 text-left transition-colors",
                  active ? "bg-panel-2" : "border-line-soft bg-bg-2 hover:border-line",
                )}
                style={active ? { borderColor: `${m.color}66`, boxShadow: `inset 0 0 0 1px ${m.color}22, 0 0 24px -12px ${m.color}` } : undefined}
              >
                <div className="font-mono text-[10.5px] tracking-[0.14em]" style={{ color: m.color }}>
                  {m.numeral}
                </div>
                <div className="mt-1.5 font-mono text-[15px] tabular text-fg">{formatBps(bp.transmissionBps)}</div>
                <div className="font-mono text-[10.5px] text-muted">weight {bp.rewardWeight}×</div>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <label htmlFor="particles" className="label">
            Particles
          </label>
          <span className="font-mono text-[10.5px] text-faint">max {maxAllowed} this round</span>
        </div>
        <div className="mt-2 flex h-11 items-stretch overflow-hidden rounded-[10px] border border-line bg-bg-2 focus-within:border-cyan/50">
          <button className="w-11 text-lg text-muted hover:text-fg disabled:opacity-30" onClick={() => setCount((c) => Math.max(1, c - 1))} disabled={count <= 1} aria-label="Fewer particles">
            −
          </button>
          <input
            id="particles"
            type="number"
            inputMode="numeric"
            min={1}
            max={maxAllowed || undefined}
            value={count}
            onChange={(e) => setCount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            className="min-w-0 flex-1 bg-transparent text-center font-mono text-lg tabular text-fg outline-none"
          />
          <button className="w-11 text-lg text-muted hover:text-fg disabled:opacity-30" onClick={() => setCount((c) => c + 1)} disabled={count >= maxAllowed} aria-label="More particles">
            +
          </button>
        </div>
        <div className="mt-2 flex gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setCount(Math.min(p, maxAllowed || p))}
              className={cx("h-7 flex-1 rounded-md border font-mono text-[11px] transition-colors", count === p ? "border-cyan/40 text-cyan" : "border-line-soft text-muted hover:text-fg")}
            >
              {p}
            </button>
          ))}
        </div>

        <dl className="mt-5 space-y-2 border-t border-line-soft pt-4 text-[12.5px]">
          <Row k="Selected barrier" v={<span style={{ color: BARRIER_META[barrier].color }}>Barrier {BARRIER_META[barrier].numeral}</span>} />
          <Row k="Transmission probability" v={b ? formatBps(b.transmissionBps) : "—"} />
          <Row k={`${count} × ${formatSol(cost)} SOL`} v={<span className="text-fg">{formatSol(total)} SOL</span>} />
          <Row k="Protocol fee" v={round ? `${formatBps(round.protocolFeeBps)} of round pool` : "—"} hint="Taken from the pooled SOL at settlement, not from your wallet now." />
          <Row k="Network fee (est.)" v={`${formatSol(networkFee, 6)} SOL`} />
          {!position && <Row k="Position account rent" v={rent.data != null ? `${formatSol(positionRent, 5)} SOL` : "—"} hint="Refunded to you when you claim." />}
          <Row k="Round" v={round ? `#${round.id.toLocaleString()}` : "—"} />
          <Row k="Time remaining" v={round ? <span className={remaining < 10 ? "text-amber" : ""}>{formatCountdown(remaining)}</span> : "—"} />
        </dl>

        <div className="mt-4 rounded-[10px] border border-line-soft bg-bg-2 p-3 font-mono text-[11px] leading-relaxed text-muted">
          <div className="text-fg-2">reward if your particles tunnel</div>
          SOL = 95% pool × your weight ÷ Σ successful weight
          <br />
          $TUNNEL = round emission × your weight ÷ Σ successful weight
        </div>

        {connected ? (
          <Button variant="primary" size="lg" className="mt-4 w-full" disabled={!!blocker} onClick={() => setConfirming(true)}>
            {blocker ?? "Review deployment"}
          </Button>
        ) : (
          <Button variant="primary" size="lg" className="mt-4 w-full" onClick={() => setPickerOpen(true)}>
            Connect wallet to mine
          </Button>
        )}
        <p className="mt-3 text-center text-[11px] leading-relaxed text-faint">You can lose some or all of the SOL you commit.</p>
      </div>

      <WalletPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
      {round && (
        <ConfirmDialog
          open={confirming}
          onClose={() => setConfirming(false)}
          round={round}
          barrier={barrier}
          count={count}
          total={total}
          positionRent={positionRent}
          networkFee={networkFee}
          now={now}
        />
      )}
    </div>
  );
}

function Row({ k, v, hint }: { k: React.ReactNode; v: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted" title={hint}>
        {k}
        {hint && <span className="ml-1 cursor-help text-faint">ⓘ</span>}
      </dt>
      <dd className="text-right font-mono tabular text-fg-2">{v}</dd>
    </div>
  );
}

function ConfirmDialog({
  open,
  onClose,
  round,
  barrier,
  count,
  total,
  positionRent,
  networkFee,
  now,
}: {
  open: boolean;
  onClose: () => void;
  round: RoundAccount;
  barrier: number;
  count: number;
  total: bigint;
  positionRent: bigint;
  networkFee: bigint;
  now: number;
}) {
  const { publicKey } = useWallet();
  const { state, send, reset } = useSendTx();
  const [ack, setAck] = useState(false);
  const m = BARRIER_META[barrier];
  const bp = round.barriers[barrier];
  const remaining = round.closeTs - now;
  const busy = state.phase === "signing" || state.phase === "confirming";

  useEffect(() => {
    if (!open) {
      reset();
      setAck(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = () => {
    if (!publicKey) return;
    const ix = new TunnelInstructions(appConfig.programId).deployParticles({ owner: publicKey, roundId: round.id, barrier, count });
    void send([ix]);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !busy && onClose()}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="panel w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-line-soft px-5 py-4">
              <div className="label">Confirm deployment</div>
              <h2 id="confirm-title" className="mt-1 text-[17px] font-semibold">
                {count} particle{count === 1 ? "" : "s"} on <span style={{ color: m.color }}>Barrier {m.numeral}</span>
              </h2>
            </div>

            {state.phase === "confirmed" ? (
              <div className="px-5 py-6">
                <div className="flex items-center gap-2 text-green">
                  <svg width="18" height="18" viewBox="0 0 18 18"><path d="M3.5 9.5l3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>
                  <span className="text-[15px] font-medium">Particles deployed</span>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">
                  Your SOL is in round #{round.id.toLocaleString()}&apos;s escrow. Outcomes are determined after the round closes and randomness is revealed.
                </p>
                <a href={explorerTx(state.signature!)} target="_blank" rel="noreferrer" className="mt-3 inline-block break-all font-mono text-[11.5px] text-cyan hover:underline">
                  {state.signature}
                </a>
                <Button className="mt-5 w-full" onClick={onClose}>
                  Done
                </Button>
              </div>
            ) : (
              <div className="px-5 py-5">
                <dl className="space-y-2 text-[13px]">
                  <Row k="Round" v={`#${round.id.toLocaleString()} · closes in ${formatCountdown(remaining)}`} />
                  <Row k="Transmission probability" v={formatBps(bp.transmissionBps)} />
                  <Row k="Reward weight per success" v={`${bp.rewardWeight}×`} />
                  <Row k="SOL committed to escrow" v={<span className="text-fg">{formatSol(total)} SOL</span>} />
                  {positionRent > 0n && <Row k="Position rent (refundable)" v={`${formatSol(positionRent, 5)} SOL`} />}
                  <Row k="Network fee (est.)" v={`${formatSol(networkFee, 6)} SOL`} />
                  <Row k="Protocol fee at settlement" v={`${formatBps(round.protocolFeeBps)} of pool`} />
                </dl>
                <div className="mt-4 rounded-[10px] border border-amber/25 bg-amber/[0.05] p-3 text-[12px] leading-relaxed text-amber/90">
                  Outcomes are random. If none of your particles tunnel you receive nothing from this round unless nobody tunnels, in which case 95% of
                  the pool is refunded pro rata. A successful tunnel does not guarantee receiving more SOL than you deposited.
                </div>
                <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-relaxed text-fg-2">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-4 accent-[#31D9F5]" />I understand I can lose some or all of the SOL I commit, and that this is not guaranteed mining income.
                </label>
                {state.phase === "failed" && <p className="mt-3 rounded-lg border border-red/25 bg-red/[0.06] p-2.5 text-[12px] text-red">{state.error}</p>}
                <div className="mt-5 flex gap-2">
                  <Button className="flex-1" onClick={onClose} disabled={busy}>
                    Cancel
                  </Button>
                  <Button variant="primary" className="flex-1" disabled={!ack || busy || remaining <= 0} onClick={submit}>
                    {state.phase === "signing" ? "Approve in wallet…" : state.phase === "confirming" ? "Confirming…" : remaining <= 0 ? "Round closed" : "Approve in wallet"}
                  </Button>
                </div>
                <p className="mt-3 text-center text-[11px] text-faint">Your wallet will show the exact transaction before you sign.</p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
