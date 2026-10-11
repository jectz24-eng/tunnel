"use client";

import { BARRIER_META, LEVEL_LABELS, formatPpb, formatSol, formatTunnel, type OddsTable } from "@tunnel/sdk";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import type { TxState } from "@/lib/tx";
import { explorerTx } from "@/lib/config";
import { Arrow, Button } from "../ui";
import type { Config } from "./ConfigPanel";

/**
 * Deployment preview: states exactly what the user signs and what it costs.
 * Mining is free of protocol charges; the wallet pays only Solana's network
 * fee and, on its first deployment of a cycle, a refundable account deposit.
 */
export function DeployDialog({
  open,
  onClose,
  onConfirm,
  config,
  odds,
  cycleId,
  closesIn,
  newPosition,
  rentLamports,
  cosign,
  tx,
  energyCost,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  config: Config;
  odds: OddsTable;
  cycleId: bigint | null;
  closesIn: string;
  newPosition: boolean;
  rentLamports: bigint | null;
  cosign: boolean;
  tx: TxState;
  energyCost: number;
}) {
  const busy = tx.phase === "authorizing" || tx.phase === "signing" || tx.phase === "sending" || tx.phase === "confirming";
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, busy, onClose]);
  const m = BARRIER_META[config.barrier];
  const reward = odds.reward[config.barrier][config.level];

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !busy && onClose()}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="deploy-title"
            initial={{ y: 16, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="panel brackets w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-line-soft px-6 py-5">
              <div className="eyebrow">Confirm experiment · cycle {cycleId?.toString() ?? "—"}</div>
              <h2 id="deploy-title" className="mt-2 text-xl font-semibold tracking-tight">
                Deploy {config.count} particle{config.count === 1 ? "" : "s"}
              </h2>
            </div>
            <dl className="divide-y divide-line-soft text-sm">
              {[
                ["Barrier", <span key="b" style={{ color: m.color }}>{m.name}</span>],
                ["Particle energy", `${LEVEL_LABELS[config.level]} · uses ⚡${energyCost} of your allowance`],
                ["Tunneling probability", formatPpb(odds.transmissionPpb[config.barrier][config.level])],
                ["Reward per success", `${formatTunnel(reward)} $TUNNEL*`],
                ["Outcome revealed", `after the cycle closes (${closesIn}) and settles`],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex items-center justify-between gap-4 px-6 py-3">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-right font-mono text-[13px]">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="border-t border-line-soft bg-bg-2/60 px-6 py-4">
              <div className="label mb-2.5">What you are signing</div>
              <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-fg-2">
                <li>
                  <span className="text-cyan">Free to mine:</span> no SOL or tokens go to the protocol. Energy comes from your cycle allowance.
                </li>
                <li>One Solana transaction (network fee ≈ 0.000005 SOL).</li>
                {newPosition && (
                  <li>
                    First deployment this cycle: a refundable account deposit of {rentLamports != null ? `${formatSol(rentLamports, 5)} SOL` : "≈ 0.002 SOL"}, returned in full when you
                    claim.
                  </li>
                )}
                {cosign && <li>The protocol&apos;s rate-limiting service co-signs this deployment (it controls no funds).</li>}
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-faint">
                *Nominal reward. If a cycle&apos;s rewards exceed its emission budget, every payout is scaled down pro rata. Outcomes are probabilistic; you
                may receive nothing.
              </p>
            </div>
            {tx.phase === "failed" && <div className="border-t border-red/20 bg-red/[0.06] px-6 py-3 text-[12.5px] text-red">{tx.error}</div>}
            <div className="flex items-center gap-2 border-t border-line-soft px-6 py-4">
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button variant="energy" className="ml-auto font-mono uppercase tracking-[0.1em]" onClick={onConfirm} disabled={busy}>
                {tx.phase === "authorizing"
                  ? "Requesting co-signature…"
                  : tx.phase === "signing"
                    ? "Approve in wallet…"
                    : tx.phase === "sending" || tx.phase === "confirming"
                      ? "Confirming…"
                      : <>Deploy particles <Arrow /></>}
              </Button>
            </div>
            {tx.signature && (
              <div className="border-t border-line-soft px-6 py-2 text-right">
                <a className="font-mono text-[11px] text-cyan hover:underline" href={explorerTx(tx.signature)} target="_blank" rel="noreferrer">
                  view transaction
                </a>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
