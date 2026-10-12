"use client";

import { VOLATILITY, formatTunnel, shortKey } from "@tunnel/sdk";
import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getJson } from "@/lib/api";
import { usePoll } from "@/lib/poll";
import { useQuality, particleBudget } from "@/lib/quality";
import type { RingApi } from "../three/AcceleratorRing";
import { Badge, ButtonLink, Dot, SectionHeading, Unavailable } from "../ui";

const AcceleratorRing = dynamic(() => import("../three/AcceleratorRing"), { ssr: false });

interface FeedRow {
  id: string;
  wallet: string;
  volatility: number;
  stake: string;
  payout: string;
  wins: number;
  count: number;
  outcomeBits: string;
  createdAt: string;
}

/**
 * LIVE ACCELERATOR — every real shot from the accelerator replayed in the
 * ring: particles that tunneled fly through the barrier, the rest bounce.
 * With no new shots the ring only shows its ambient effects.
 */
export function LiveAccelerator() {
  const q = useQuality();
  const ring = useRef<RingApi>(null);
  const seen = useRef<Set<string> | null>(null);
  const [lastLive, setLastLive] = useState<number | null>(null);
  const feed = usePoll("home:feed", () => getJson<{ rows: FeedRow[] }>("/api/casino/bets?limit=12"), 2_500);
  const rows = feed.data?.data?.rows ?? [];

  useEffect(() => {
    if (!feed.data?.available) return;
    const ids = new Set(rows.map((r) => r.id));
    if (!seen.current) {
      seen.current = ids; // existing shots: listed, not replayed
      return;
    }
    const fresh = rows.filter((r) => !seen.current!.has(r.id));
    seen.current = ids;
    if (!fresh.length) return;
    setLastLive(Date.now());
    const api = ring.current;
    if (!api) return;
    fresh.forEach((r, k) => {
      const color = VOLATILITY[r.volatility]?.color ?? "#00D9FF";
      r.outcomeBits
        .split("")
        .slice(0, 14)
        .forEach((bit, i) => api.launch({ color, outcome: bit === "1" ? "tunnel" : "reflect", delay: k * 0.6 + i * 0.09 }));
    });
  }, [feed.data, rows]);

  const live = !!feed.data?.available;
  const quiet = !lastLive || Date.now() - lastLive > 120_000;

  return (
    <section className="relative overflow-hidden border-y border-line-soft" aria-labelledby="live-title">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_70%_at_30%_50%,#0B1424_0%,#05070B_70%)]" />
      <div className="relative mx-auto grid max-w-[1400px] gap-10 px-4 py-24 sm:px-6 lg:grid-cols-[1.35fr_1fr] lg:py-28">
        <div className="relative h-[380px] overflow-hidden rounded-2xl border border-line-soft bg-bg/40 sm:h-[520px]">
          {q.webgl && <AcceleratorRing mode="live" apiRef={ring} framing="panel" particles={particleBudget(q.tier, 140)} dpr={q.dpr} reducedMotion={q.reducedMotion} className="absolute inset-0" />}
          <div className="absolute left-4 top-4 flex items-center gap-2">
            <Badge tone={live ? "cyan" : "neutral"}>
              <Dot color={live ? "#00D9FF" : "#4c5a69"} pulse={live} /> {live ? "Live" : feed.data ? "Offline" : "Connecting"}
            </Badge>
          </div>
          <AnimatePresence>
            {quiet && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-x-4 bottom-4 rounded-lg border border-line-soft bg-bg/70 px-3 py-2 font-mono text-[10.5px] tracking-[0.08em] text-muted backdrop-blur"
              >
                WAITING FOR THE NEXT SHOT · NEW SHOTS REPLAY HERE THE MOMENT THEY LAND
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="flex flex-col">
          <SectionHeading eyebrow="03 / Live accelerator" title={<span id="live-title">Every shot, as it happens.</span>}>
            When anyone fires, their particles replay in this ring. The ones that tunnel streak through the barrier. The rest bounce back.
          </SectionHeading>
          <div className="panel mt-8 flex-1 overflow-hidden">
            <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
              <span className="label">Latest shots</span>
              <span className="font-mono text-[10.5px] text-faint">live</span>
            </div>
            {feed.data && !feed.data.available ? (
              <div className="p-4">
                <Unavailable what="Live shots" />
              </div>
            ) : rows.length === 0 ? (
              <p className="p-4 text-sm text-muted">No shots yet. Be the first to fire.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {rows.slice(0, 9).map((r) => {
                  const v = VOLATILITY[r.volatility];
                  const net = BigInt(r.payout) - BigInt(r.stake);
                  return (
                    <motion.li key={r.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}>
                      <Link href={`/history/bet/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-panel-2/60">
                        <span className="w-24 truncate font-mono text-fg-2">{shortKey(r.wallet)}</span>
                        <span className="font-mono text-[11px]" style={{ color: v.color }}>
                          {v.short}
                        </span>
                        <span className="font-mono text-muted">
                          {r.wins}/{r.count} tunneled
                        </span>
                        <span className={`ml-auto font-mono tabular ${net > 0n ? "text-flare" : "text-muted"}`}>
                          {net > 0n ? `+${formatTunnel(net)}` : formatTunnel(BigInt(r.payout))}
                        </span>
                      </Link>
                    </motion.li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="mt-4">
            <ButtonLink href="/history" variant="secondary" size="sm">
              Every shot, on the record
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}
