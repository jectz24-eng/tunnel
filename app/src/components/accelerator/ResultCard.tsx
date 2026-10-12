"use client";

import { BARRIER_META, LEVEL_LABELS, formatPpb, formatTunnel } from "@tunnel/sdk";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { explorerBlock } from "@/lib/config";
import type { CycleAccount } from "@/lib/types";
import type { RevealPlan } from "@/lib/reveal";
import { Arrow, Badge, Button, ButtonLink } from "../ui";

/** PHASE 4 — the settled result of a cycle's experiments for this wallet. */
export function ResultCard({ plan, cycle, onRunAgain, onReplay }: { plan: RevealPlan; cycle: CycleAccount; onRunAgain: () => void; onReplay: () => void }) {
  const [copied, setCopied] = useState(false);
  const tunneled = plan.successes > 0;
  const cells = new Map<string, { b: number; l: number; n: number; s: number; ppb: number }>();
  for (const p of plan.particles) {
    const k = `${p.barrier}:${p.level}`;
    const c = cells.get(k) ?? { b: p.barrier, l: p.level, n: 0, s: 0, ppb: p.ppb };
    c.n++;
    if (p.success) c.s++;
    cells.set(k, c);
  }
  const share = async () => {
    const text = `TUNNEL cycle ${cycle.id}: ${plan.successes}/${plan.total} particles tunneled${plan.payout != null && plan.payout > 0n ? ` · ${formatTunnel(plan.payout)} $TUNNEL` : ""}. Mine through the impossible.`;
    const url = `${window.location.origin}/history/cycle/${cycle.id}`;
    try {
      if (navigator.share) await navigator.share({ title: "TUNNEL experiment", text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* user cancelled share */
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="panel brackets overflow-hidden">
      <div className={`relative border-b border-line-soft px-6 py-6 ${tunneled ? "bg-[radial-gradient(ellipse_at_top_left,rgba(0,217,255,0.12),transparent_60%)]" : "bg-[radial-gradient(ellipse_at_top_left,rgba(240,166,75,0.08),transparent_60%)]"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tunneled ? "flare" : "amber"}>{tunneled ? "Tunneling successful" : "Particles reflected"}</Badge>
          <Badge tone={plan.verified ? "cyan" : "red"}>{plan.verified ? "Verified in your browser" : "Verification mismatch"}</Badge>
          <span className="ml-auto font-mono text-[11px] text-faint">CYCLE {cycle.id.toString()}</span>
        </div>
        <div className="mt-5 flex flex-wrap items-end gap-x-10 gap-y-4">
          <div>
            <div className="label">Tunneled</div>
            <div className="mt-1 font-mono text-[40px] font-medium tabular leading-none">
              {plan.successes}
              <span className="text-xl text-faint"> / {plan.total}</span>
            </div>
          </div>
          <div>
            <div className="label">Reward</div>
            <div className={`mt-1 font-mono text-[40px] font-medium tabular leading-none ${tunneled ? "text-flare glow-text" : "text-fg-2"}`}>
              {plan.payout == null ? <span className="text-xl text-muted">finalizing…</span> : formatTunnel(plan.payout)}
              <span className="ml-2 text-base text-muted">$TUNNEL</span>
            </div>
            {plan.payout != null && plan.payout < plan.nominal && <div className="mt-1 text-[11px] text-amber">scaled by the cycle&apos;s emission cap (nominal {formatTunnel(plan.nominal)})</div>}
          </div>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line-soft text-left">
            {["Barrier", "Energy", "Probability", "Particles", "Tunneled"].map((h) => (
              <th key={h} className="label px-6 py-2.5 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...cells.values()].map((c) => (
            <tr key={`${c.b}${c.l}`} className="border-b border-line-soft last:border-0">
              <td className="px-6 py-2.5 font-mono text-xs" style={{ color: BARRIER_META[c.b].color }}>
                {BARRIER_META[c.b].short}
              </td>
              <td className="px-6 py-2.5 font-mono text-xs">{LEVEL_LABELS[c.l]}</td>
              <td className="px-6 py-2.5 font-mono text-xs">{formatPpb(c.ppb)}</td>
              <td className="px-6 py-2.5 font-mono text-xs">{c.n}</td>
              <td className="px-6 py-2.5 font-mono text-xs">{c.s > 0 ? <span className="text-flare">{c.s}</span> : <span className="text-amber">0</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-1.5 border-t border-line-soft bg-bg-2/50 px-6 py-4 font-mono text-[11px] text-muted">
        <div className="flex justify-between gap-3">
          <span>Server seed (committed before deployments)</span>
          <span className="truncate text-fg-2">{cycle.serverSeed?.slice(0, 24)}…</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Solana entropy block</span>
          {cycle.entropySlotUsed != null ? (
            <a className="truncate text-fg-2 hover:text-cyan" href={explorerBlock(cycle.entropySlotUsed)} target="_blank" rel="noreferrer">
              slot {cycle.entropySlotUsed.toString()} · {cycle.entropyBlockhash?.slice(0, 12)}…
            </a>
          ) : (
            <span>—</span>
          )}
        </div>
        <div className="flex justify-between gap-3">
          <span>Randomness</span>
          <span className="truncate text-fg-2">{cycle.randomnessHex?.slice(0, 24)}…</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line-soft px-6 py-4">
        <Button variant="energy" className="font-mono uppercase tracking-[0.1em]" onClick={onRunAgain}>
          Run again <Arrow />
        </Button>
        <ButtonLink href={`/history/cycle/${cycle.id}`} variant="secondary">
          View experiment
        </ButtonLink>
        <Button variant="secondary" onClick={share}>
          {copied ? "Copied" : "Share result"}
        </Button>
        <Button variant="ghost" onClick={onReplay} className="ml-auto">
          Replay
        </Button>
      </div>
      <div className="px-6 pb-4 text-[11px] text-faint">
        Claim this reward in <Link href="#claims" className="text-cyan hover:underline">Claims</Link>. Rewards stay claimable indefinitely.
      </div>
    </motion.div>
  );
}
