"use client";

import { BARRIER_META } from "@tunnel/sdk";
import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import { useQuality, particleBudget } from "@/lib/quality";
import { useActivity, type ActivityEvent } from "@/lib/stream";
import { ActivityLine } from "../ActivityLine";
import type { RingApi } from "../three/AcceleratorRing";
import { Badge, ButtonLink, Dot, SectionHeading, Unavailable } from "../ui";

const AcceleratorRing = dynamic(() => import("../three/AcceleratorRing"), { ssr: false });

/**
 * LIVE ACCELERATOR — a real-time view of protocol activity. Particles enter
 * the ring only for real indexed `ParticlesDeployed` events, and resolve at
 * the barrier only from real `CycleFinalized` tunnel counts. Nothing is
 * invented: with no activity, the ring is empty except for ambient effects,
 * which are labelled.
 */
export function LiveAccelerator() {
  const q = useQuality();
  const ring = useRef<RingApi>(null);
  const [lastLive, setLastLive] = useState<number | null>(null);

  const onLive = useCallback((e: ActivityEvent) => {
    const api = ring.current;
    setLastLive(Date.now());
    if (!api) return;
    if (e.name === "ParticlesDeployed") {
      const n = Math.min(Number(e.data.count), 14);
      const color = BARRIER_META[Number(e.data.barrier)]?.color ?? "#00D9FF";
      for (let i = 0; i < n; i++) api.launch({ color, outcome: "orbit", delay: i * 0.08 });
    } else if (e.name === "CycleFinalized") {
      const successes = (e.data.successes as string[]).map(Number);
      successes.forEach((s, b) => {
        for (let i = 0; i < Math.min(s, 10); i++) api.launch({ color: BARRIER_META[b].color, outcome: "tunnel", delay: i * 0.15 + b * 0.4 });
      });
    }
  }, []);

  const { events, available, live } = useActivity(14, onLive);
  const quiet = !lastLive || Date.now() - lastLive > 120_000;

  return (
    <section className="relative overflow-hidden border-y border-line-soft" aria-labelledby="live-title">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_70%_at_30%_50%,#0B1424_0%,#05070B_70%)]" />
      <div className="relative mx-auto grid max-w-[1400px] gap-10 px-4 py-24 sm:px-6 lg:grid-cols-[1.35fr_1fr] lg:py-28">
        <div className="relative h-[380px] overflow-hidden rounded-2xl border border-line-soft bg-bg/40 sm:h-[520px]">
          {q.webgl && (
            <AcceleratorRing
              mode="live"
              apiRef={ring}
              framing="panel"
              particles={particleBudget(q.tier, 140)}
              dpr={q.dpr}
              reducedMotion={q.reducedMotion}
              className="absolute inset-0"
            />
          )}
          <div className="absolute left-4 top-4 flex items-center gap-2">
            <Badge tone={live ? "cyan" : "neutral"}>
              <Dot color={live ? "#00D9FF" : "#4c5a69"} pulse={live} /> {live ? "Live stream" : available === false ? "Indexer offline" : "Connecting"}
            </Badge>
          </div>
          <AnimatePresence>
            {quiet && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-x-4 bottom-4 rounded-lg border border-line-soft bg-bg/70 px-3 py-2 font-mono text-[10.5px] tracking-[0.08em] text-muted backdrop-blur">
                NO LIVE DEPLOYMENTS SINCE YOU OPENED THIS PAGE · RING ENERGY AND DUST ARE VISUAL EFFECTS
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="flex flex-col">
          <SectionHeading eyebrow="03 / Live accelerator" title={<span id="live-title">Real particles. Real outcomes.</span>}>
            Every particle that enters this ring is a real deployment indexed from the chain, and every pass through the barrier is a settled tunnel
            reported by the program.
          </SectionHeading>
          <div className="panel mt-8 flex-1 overflow-hidden">
            <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
              <span className="label">Protocol activity</span>
              <span className="font-mono text-[10.5px] text-faint">indexed · confirmed</span>
            </div>
            <div className="space-y-3 p-4">
              {available === false && <Unavailable what="Live activity" />}
              {available && events.length === 0 && <p className="text-sm text-muted">No protocol activity has been indexed yet.</p>}
              {events.slice(0, 9).map((e) => (
                <motion.div key={e.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}>
                  <ActivityLine e={e} />
                </motion.div>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <ButtonLink href="/history" variant="secondary" size="sm">
              Open the experiment archive
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}
