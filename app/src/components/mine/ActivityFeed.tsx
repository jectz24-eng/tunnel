"use client";

import { BARRIER_META, formatSol, formatTunnel, shortKey } from "@tunnel/sdk";
import { AnimatePresence, motion } from "motion/react";
import { explorerTx } from "@/lib/config";
import { useActivity, type ActivityEvent } from "@/lib/stream";
import { Dot, Empty, cx } from "../ui";

function describe(e: ActivityEvent): { text: React.ReactNode; tone?: string } | null {
  const d = e.data;
  switch (e.name) {
    case "ParticlesDeployed": {
      const m = BARRIER_META[Number(d.barrier)];
      return {
        text: (
          <>
            <span className="text-fg-2">{shortKey(e.owner ?? "")}</span> deployed <span className="text-fg">{d.count}</span> on{" "}
            <span style={{ color: m?.color }}>{m?.numeral}</span>
          </>
        ),
      };
    }
    case "RewardClaimed":
      return {
        text: (
          <>
            <span className="text-fg-2">{shortKey(e.owner ?? "")}</span> claimed {formatSol(BigInt(d.lamports), 3)} SOL
            {BigInt(d.tokens) > 0n && <> · {formatTunnel(BigInt(d.tokens), 0)} $TUNNEL</>}
          </>
        ),
        tone: "#45E6B0",
      };
    case "RoundFinalized": {
      const outcome = Number(d.outcome);
      if (outcome === 4) return null;
      const succ = (d.successes as string[]).reduce((a, b) => a + Number(b), 0);
      return {
        text: outcome === 1 ? <>Round {e.roundId} settled · {succ} tunnelled</> : outcome === 2 ? <>Round {e.roundId} · no tunnels · refunds open</> : <>Round {e.roundId} failed · full refunds</>,
        tone: outcome === 1 ? "#45E6B0" : "#F5C26B",
      };
    }
    case "RandomnessRevealed":
      return { text: <>Round {e.roundId} randomness revealed</>, tone: "#9B75FF" };
    case "RoundClosed":
      return { text: <>Round {e.roundId} closed · {d.participants} participants</> };
    case "RoundFailed":
      return { text: <>Round {e.roundId} entered recovery</>, tone: "#FF7285" };
    default:
      return null;
  }
}

export function ActivityFeed({ limit = 24, className }: { limit?: number; className?: string }) {
  const { events, available, live } = useActivity(limit);
  const rows = events.map((e) => ({ e, d: describe(e) })).filter((r) => r.d);

  return (
    <div className={className}>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="label">Live activity</span>
        <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted">
          {available === false ? "indexer offline" : live ? (<><Dot color="#45E6B0" pulse /> streaming</>) : "connecting"}
        </span>
      </div>
      {available === false ? (
        <Empty title="Activity feed unavailable">The indexer is not reachable, so recent events can&apos;t be listed. Onchain round state above is unaffected.</Empty>
      ) : rows.length === 0 ? (
        <Empty title="No activity yet">Deposits, settlements and claims appear here as they are confirmed.</Empty>
      ) : (
        <ul className="max-h-[340px] overflow-y-auto px-2 pb-2">
          <AnimatePresence initial={false}>
            {rows.map(({ e, d }) => (
              <motion.li
                key={e.id}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="group flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-panel-2"
              >
                <span className="mt-[7px] size-1 shrink-0 rounded-full" style={{ background: d!.tone ?? "#56657A" }} />
                <div className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted">{d!.text}</div>
                <a href={explorerTx(e.signature)} target="_blank" rel="noreferrer" className={cx("shrink-0 font-mono text-[10.5px] text-faint hover:text-cyan")} title="View transaction">
                  {e.blockTime ? new Date(e.blockTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "tx"}
                </a>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
