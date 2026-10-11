"use client";

import { motion, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { useQuality, particleBudget } from "@/lib/quality";
import type { Annotation } from "../three/AcceleratorRing";
import { StaticAccelerator } from "../three/StaticAccelerator";
import { Arrow, ButtonLink, cx } from "../ui";

const AcceleratorRing = dynamic(() => import("../three/AcceleratorRing"), { ssr: false, loading: () => null });

/** Labels pinned to parts of the 3D machine, each visible during one chapter of the scroll. */
const LABELS: (Annotation & { title: string; detail: string; index: string })[] = [
  { id: "ring", anchor: "ring", window: [0.11, 0.42], index: "01", title: "Storage ring", detail: "particles circulate here until the cycle closes" },
  { id: "magnets", anchor: "magnets", window: [0.13, 0.42], index: "02", title: "Dipole magnets", detail: "72 C-yokes steer the beam around the ring" },
  { id: "core", anchor: "core", window: [0.16, 0.4], side: "right", index: "03", title: "Quantum core", detail: "energy source for every cycle's allowance" },
  { id: "conduits", anchor: "conduits", window: [0.18, 0.4], side: "left", index: "04", title: "Energy conduits", detail: "feed particle energy E into the beam" },
  { id: "barrier", anchor: "barrier", window: [0.42, 0.68], index: "05", title: "Potential barrier · V₀", detail: "a wall of height V₀ the particle cannot classically cross" },
  { id: "width", anchor: "width", window: [0.45, 0.68], index: "06", title: "Barrier width · a", detail: "T falls roughly as e^(−2κa): thicker means rarer" },
  { id: "pylon", anchor: "pylon", window: [0.47, 0.66], index: "07", title: "Emitter pylons", detail: "hold the field that forms the barrier" },
  { id: "transmission", anchor: "transmission", window: [0.64, 0.8], index: "08", title: "Transmission zone", detail: "tunneled particles continue · reflected ones turn back" },
];

const CHAPTERS = [
  { at: 0.11, until: 0.42, n: "I", title: "The accelerator", body: "Particles are injected, charged and held in the storage ring." },
  { at: 0.42, until: 0.68, n: "II", title: "The barrier", body: "Each barrier has a height V₀ and a width a. Together with the particle's energy E, they fix the odds." },
  { at: 0.66, until: 0.82, n: "III", title: "Through the wall", body: "When the cycle closes, verifiable randomness decides which particles make it to the other side." },
];

/**
 * Cinematic hero. A long scroll stage: the headline gives way to a guided
 * camera move around the accelerator (overview → barrier → beam line →
 * through the barrier) with labels pinned to the parts of the machine, then
 * the scene dissolves into the page. The animation is a visual simulation,
 * labelled as such; it is not live mining data.
 */
export function Hero() {
  const section = useRef<HTMLElement>(null);
  const scrollRef = useRef(0);
  const labelRefs = useRef<Record<string, HTMLElement | null>>({});
  const q = useQuality();
  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end end"] });
  const p = useSpring(scrollYProgress, { stiffness: 90, damping: 26, mass: 0.6, restDelta: 0.0005 });
  useMotionValueEvent(scrollYProgress, "change", (v) => (scrollRef.current = v));

  const titleOpacity = useTransform(p, [0, 0.1], [1, 0]);
  const titleY = useTransform(p, [0, 0.12], [0, -80]);
  const titleBlur = useTransform(p, [0, 0.1], ["blur(0px)", "blur(8px)"]);
  const vignette = useTransform(p, [0, 0.15, 0.85], [0.55, 0.25, 0.4]);
  const flare = useTransform(p, [0.72, 0.8, 0.88], [0, 0.6, 0]);
  const fadeOut = useTransform(p, [0.78, 0.9], [0, 1]);
  const railFill = useTransform(p, [0.1, 0.82], ["0%", "100%"]);
  const hintOpacity = useTransform(p, [0, 0.05], [1, 0]);

  return (
    <section ref={section} className="relative -mt-16 h-[260vh] sm:h-[320vh]" aria-label="Mine through the impossible">
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        {/* backdrop */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_45%,#0B1424_0%,#05070B_70%)]" />
        <div className="grid-backdrop absolute inset-0 opacity-50" />
        {q.webgl === true ? (
          <AcceleratorRing
            mode="decorative"
            scrollRef={scrollRef}
            particles={particleBudget(q.tier, 170)}
            dpr={q.dpr}
            reducedMotion={q.reducedMotion}
            annotations={LABELS}
            annotationRefs={labelRefs}
            className="absolute inset-0"
          />
        ) : q.webgl === false ? (
          <StaticAccelerator className="absolute inset-0 m-auto h-[70%] w-[90%] max-w-4xl opacity-90" />
        ) : null}

        {/* atmosphere */}
        <motion.div style={{ opacity: vignette }} className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_75%_75%_at_50%_50%,transparent_40%,#05070B_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-bg/80 to-transparent" />
        <motion.div style={{ opacity: flare }} className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(234,251,255,0.9),rgba(0,217,255,0.35)_25%,transparent_60%)] mix-blend-screen" />

        {/* pinned labels (positioned every frame by the 3D scene) */}
        {q.webgl === true && (
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            {LABELS.map((l) => (
              <div
                key={l.id}
                ref={(el) => void (labelRefs.current[l.id] = el)}
                className="group absolute left-0 top-0 will-change-transform"
                style={{ opacity: 0, visibility: "hidden" }}
                data-side="right"
              >
                <span className="absolute -left-[5px] -top-[5px] size-2.5 rounded-full bg-cyan shadow-[0_0_12px_#00D9FF]" />
                <span className="absolute -left-[11px] -top-[11px] size-[22px] animate-ping rounded-full border border-cyan/40 [animation-duration:2.4s]" />
                <span className="absolute top-0 h-px w-12 bg-gradient-to-r from-cyan/80 to-cyan/20 group-data-[side=left]:right-0 group-data-[side=left]:rotate-180 group-data-[side=right]:left-0 sm:w-16" />
                <span className="absolute top-0 w-max max-w-[calc(50vw-72px)] -translate-y-1/2 rounded-lg sm:max-w-none sm:whitespace-nowrap border border-cyan/25 bg-bg/70 px-3 py-2 backdrop-blur-md group-data-[side=left]:right-14 group-data-[side=right]:left-14 sm:group-data-[side=left]:right-[72px] sm:group-data-[side=right]:left-[72px]">
                  <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] text-cyan sm:text-[10.5px]">
                    <span className="text-faint">{l.index}</span>
                    {l.title.toUpperCase()}
                  </span>
                  <span className="mt-1 hidden font-mono text-[10.5px] text-muted sm:block">{l.detail}</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* chapter captions */}
        {CHAPTERS.map((c) => (
          <Chapter key={c.n} p={p} {...c} />
        ))}

        {/* progress rail */}
        <div className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 flex-col items-end gap-5 sm:flex lg:right-6">
          <div className="absolute right-[3px] top-0 h-full w-px bg-line">
            <motion.div style={{ height: railFill }} className="w-px bg-cyan shadow-[0_0_6px_#00D9FF]" />
          </div>
          {CHAPTERS.map((c) => (
            <RailStep key={c.n} p={p} {...c} />
          ))}
        </div>

        {/* headline */}
        <motion.div style={{ opacity: titleOpacity, y: titleY, filter: titleBlur }} className="absolute inset-x-0 bottom-0 pb-[12vh] sm:pb-[14vh]">
          <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
            <div className="eyebrow flex items-center gap-3">
              <span className="inline-block h-px w-8 bg-cyan/70" />
              TUNNEL / QUANTUM EXPERIMENT 001
            </div>
            <h1 className="display mt-6 text-[clamp(44px,8.4vw,128px)]">
              <span className="block">MINE THROUGH</span>
              <span className="block bg-[linear-gradient(95deg,#F3F7FA_0%,#EAFBFF_35%,#00D9FF_70%,#885BFF_100%)] bg-clip-text text-transparent">THE IMPOSSIBLE.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-fg-2 sm:text-lg">Deploy particles. Defy energy barriers. Discover what makes it through.</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/accelerator" variant="energy" size="lg" className="font-mono uppercase">
                Enter the accelerator <Arrow />
              </ButtonLink>
              <ButtonLink href="#protocol" variant="secondary" size="lg" className="font-mono uppercase backdrop-blur">
                Explore the protocol
              </ButtonLink>
            </div>
          </div>
        </motion.div>

        <div className="absolute bottom-5 right-4 font-mono text-[10px] tracking-[0.18em] text-faint sm:right-6">VISUAL SIMULATION · NOT LIVE DATA</div>
        <motion.div style={{ opacity: hintOpacity }} className="absolute bottom-5 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 sm:flex">
          <span className="font-mono text-[10px] tracking-[0.24em] text-faint">SCROLL TO EXPLORE</span>
          <span className="relative h-9 w-px overflow-hidden bg-line">
            <span className="hero-scroll-dot absolute inset-x-0 top-0 h-3 bg-cyan" />
          </span>
        </motion.div>
        <motion.div style={{ opacity: fadeOut }} className="pointer-events-none absolute inset-0 bg-bg" />
      </div>
    </section>
  );
}

function Chapter({ p, at, until, n, title, body }: { p: MotionValue<number>; at: number; until: number; n: string; title: string; body: string }) {
  const opacity = useTransform(p, [at, at + 0.05, until - 0.05, until], [0, 1, 1, 0]);
  const y = useTransform(p, [at, at + 0.05, until - 0.05, until], [24, 0, 0, -24]);
  return (
    <motion.div style={{ opacity, y }} className="pointer-events-none absolute bottom-[8vh] left-4 max-w-[min(420px,calc(100vw-2rem))] sm:bottom-[10vh] sm:left-6 lg:left-[max(1.5rem,calc((100vw-1400px)/2+1.5rem))]">
      <div className="flex items-center gap-3 font-mono text-[11px] tracking-[0.24em] text-cyan">
        <span className="flex size-7 items-center justify-center rounded-full border border-cyan/40 text-[10px]">{n}</span>
        CHAPTER {n}
      </div>
      <h2 className="mt-4 text-[32px] font-semibold leading-none tracking-[-0.03em] sm:text-[48px]">{title}</h2>
      <p className="mt-4 text-sm leading-relaxed text-fg-2 sm:text-base">{body}</p>
    </motion.div>
  );
}

function RailStep({ p, at, until, title }: { p: MotionValue<number>; at: number; until: number; title: string }) {
  const [active, setActive] = useState(false);
  useMotionValueEvent(p, "change", (v) => setActive(v >= at && v < until));
  return (
    <div className="relative flex items-center gap-3">
      <span className={cx("font-mono text-[10px] tracking-[0.18em] transition-colors duration-300", active ? "text-fg" : "text-faint")}>{title.toUpperCase()}</span>
      <span className={cx("relative z-10 flex size-[7px] rounded-full border transition-all duration-300", active ? "border-cyan bg-cyan shadow-[0_0_10px_#00D9FF]" : "border-line bg-bg")} />
    </div>
  );
}
