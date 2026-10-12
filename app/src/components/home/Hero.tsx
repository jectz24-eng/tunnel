"use client";

import { formatTunnel } from "@tunnel/sdk";
import { motion } from "motion/react";
import dynamic from "next/dynamic";
import { useRef } from "react";
import { splitCycles, useChainClock, useCycles } from "@/lib/chain";
import { formatCountdown } from "@/lib/cycle";
import { useQuality, particleBudget } from "@/lib/quality";
import type { Annotation } from "../three/AcceleratorRing";
import { StaticAccelerator } from "../three/StaticAccelerator";
import { Arrow, ButtonLink, Dot } from "../ui";

const AcceleratorRing = dynamic(() => import("../three/AcceleratorRing"), { ssr: false, loading: () => null });

/** A few labels pinned to parts of the machine (always visible, no scroll choreography). */
const LABELS: (Annotation & { title: string; detail: string; delay: number })[] = [
  { id: "ring", anchor: "ringBack", window: [-1, 2], side: "left", title: "Storage ring", detail: "particles circulate until the cycle closes", delay: 0.9 },
  { id: "barrier", anchor: "barrierTop", window: [-1, 2], side: "left", title: "Potential barrier", detail: "height V₀ · width a", delay: 1.15 },
  { id: "transmission", anchor: "transmission", window: [-1, 2], side: "right", title: "Transmission zone", detail: "where tunneled particles emerge", delay: 1.4 },
];

const ease = [0.16, 1, 0.3, 1] as const;

/**
 * Hero: a full-screen opening with the 3D accelerator (pointer parallax, no
 * scroll choreography), labels pinned to its parts, and a strip of live
 * live figures. The animation itself is a visual simulation, labelled as such.
 */
export function Hero() {
  const q = useQuality();
  const labelRefs = useRef<Record<string, HTMLElement | null>>({});
  const scrollRef = useRef(0);

  return (
    <section className="relative -mt-16 flex h-[100svh] min-h-[640px] flex-col overflow-hidden" aria-label="Mine through the impossible">
      {/* backdrop + scene */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_62%_45%,#0B1628_0%,#05070B_70%)]" />
      <div className="grid-backdrop absolute inset-0 opacity-50" />
      {/* On large screens the machine lives in the right-hand column so the headline never covers it. */}
      <div className="absolute inset-0 opacity-40 lg:left-[calc(50%-150px)] lg:right-[max(0px,calc(50%-860px))] lg:opacity-100">
      <motion.div className="absolute inset-0" initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.6, ease }}>
        {q.webgl === true ? (
          <AcceleratorRing
            mode="decorative"
            scrollRef={scrollRef}
            particles={particleBudget(q.tier, 170)}
            dpr={q.dpr}
            reducedMotion={q.reducedMotion}
            annotations={q.mobile ? undefined : LABELS}
            annotationRefs={labelRefs}
            className="absolute inset-0"
          />
        ) : q.webgl === false ? (
          <StaticAccelerator className="absolute inset-0 m-auto h-[70%] w-[90%] max-w-4xl opacity-90" />
        ) : null}
      </motion.div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_75%_75%_at_55%_50%,transparent_45%,#05070B_100%)]" />

      {/* pinned labels (positioned every frame by the 3D scene) */}
      {q.webgl === true && !q.mobile && (
        <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden="true">
          {LABELS.map((l) => (
            <div key={l.id} ref={(el) => void (labelRefs.current[l.id] = el)} className="group absolute left-0 top-0" style={{ opacity: 0, visibility: "hidden" }} data-side="right">
              <span className="label-in absolute inset-0" style={{ animationDelay: `${l.delay}s` }}>
                <span className="absolute -left-[4px] -top-[4px] size-2 rounded-full bg-cyan shadow-[0_0_12px_#00D9FF]" />
                <span className="absolute -left-[10px] -top-[10px] size-5 animate-ping rounded-full border border-cyan/40 [animation-duration:2.6s]" />
                <span className="leader-line absolute top-0 h-px w-14 group-data-[side=left]:right-0 group-data-[side=left]:rotate-180 group-data-[side=right]:left-0" />
              </span>
              <span className="label-in absolute top-[-23px] flex h-[46px] w-max flex-col justify-center rounded-lg border border-cyan/25 bg-[#070b12]/90 px-3.5 shadow-[0_8px_30px_-12px_rgba(0,217,255,0.35)] group-data-[side=left]:right-16 group-data-[side=right]:left-16" style={{ animationDelay: `${l.delay + 0.1}s` }}>
                <span className="block font-mono text-[11px] font-medium tracking-[0.16em] text-cyan antialiased">{l.title.toUpperCase()}</span>
                <span className="mt-1 block font-mono text-[11px] text-fg-2/80 antialiased">{l.detail}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-bg/80 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[70%] bg-gradient-to-r from-bg/85 via-bg/40 to-transparent lg:w-[50%] lg:from-bg lg:via-bg/60" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-bg to-transparent" />

      {/* headline */}
      <div className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-1 flex-col justify-center px-4 pt-16 sm:px-6">
        <div className="lg:max-w-[min(640px,42vw)]">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 0.15 }} className="eyebrow flex items-center gap-3">
          <span className="inline-block h-px w-8 bg-cyan/70" />
          TUNNEL / QUANTUM EXPERIMENT 001
        </motion.div>
        <h1 className="display mt-6 max-w-[11ch] text-[clamp(40px,9vw,64px)] lg:max-w-none lg:whitespace-nowrap lg:text-[clamp(44px,4.1vw,72px)]">
          {["MINE THROUGH", "THE IMPOSSIBLE."].map((line, i) => (
            <span key={line} className="block overflow-hidden pb-[0.06em]">
              <motion.span
                className={i ? "block bg-[linear-gradient(95deg,#F3F7FA_0%,#EAFBFF_35%,#00D9FF_70%,#885BFF_100%)] bg-clip-text text-transparent" : "block"}
                initial={{ y: "105%" }}
                animate={{ y: 0 }}
                transition={{ duration: 1, ease, delay: 0.25 + i * 0.12 }}
              >
                {line}
              </motion.span>
            </span>
          ))}
        </h1>
        <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 0.55 }} className="mt-6 max-w-xl text-base leading-relaxed text-fg-2 sm:text-lg">
          Deploy particles. Defy energy barriers. Discover what makes it through.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 0.7 }} className="mt-9 flex flex-wrap gap-3">
          <ButtonLink href="/accelerator" variant="energy" size="lg" className="font-mono uppercase">
            Enter the accelerator <Arrow />
          </ButtonLink>
          <ButtonLink href="#protocol" variant="secondary" size="lg" className="font-mono uppercase backdrop-blur">
            Explore the protocol
          </ButtonLink>
        </motion.div>
        </div>
      </div>

      <div className="pointer-events-none relative z-10 mx-auto w-full max-w-[1400px] px-4 pb-3 text-right font-mono text-[10px] tracking-[0.18em] text-faint sm:px-6">
        VISUAL SIMULATION · NOT LIVE DATA
      </div>

      {/* live strip */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.9 }} className="relative z-10">
        <LiveStrip />
      </motion.div>
    </section>
  );
}

/** Live protocol figures; dashes (not zeros) when TUNNEL is unreachable. */
function LiveStrip() {
  const { now } = useChainClock(1000);
  const cycles = useCycles();
  const p = cycles.protocol.data;
  const { current } = splitCycles(cycles.data, now);
  const items: [string, string | null, boolean?][] = [
    ["Current cycle", current ? `#${current.id}` : null],
    ["Closes in", current ? formatCountdown(current.closeTs - now) : null, true],
    ["Wallets this cycle", current ? String(current.participants) : null],
    ["Particles deployed", p ? p.totals.particles.toLocaleString() : null],
    ["Successful tunnels", p ? p.totals.successes.toLocaleString() : null],
    ["Emissions reserve", p ? `${formatTunnel(p.reserveAvailable, 0)}` : null],
  ];
  return (
    <div className="border-t border-line-soft bg-bg/50 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1400px] items-center gap-6 overflow-x-auto px-4 py-4 sm:px-6">
        <span className="flex shrink-0 items-center gap-2 font-mono text-[10.5px] tracking-[0.18em] text-cyan">
          <Dot color={current ? "#00D9FF" : "#4c5a69"} pulse={!!current} /> LIVE
        </span>
        {items.map(([k, v, accent]) => (
          <div key={k} className="flex shrink-0 items-baseline gap-2 border-l border-line-soft pl-6">
            <span className="text-[11px] text-muted">{k}</span>
            <span className={`font-mono text-[13px] tabular ${accent ? "text-cyan" : "text-fg"}`}>{v ?? "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
