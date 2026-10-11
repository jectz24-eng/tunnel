"use client";

import { motion, useScroll, useTransform } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { useQuality, particleBudget } from "@/lib/quality";
import { Arrow, ButtonLink } from "../ui";
import { StaticAccelerator } from "../three/StaticAccelerator";

const AcceleratorRing = dynamic(() => import("../three/AcceleratorRing"), { ssr: false, loading: () => null });

/**
 * Cinematic hero. The section is taller than the viewport: scrolling through
 * it moves the camera toward the potential barrier while technical
 * annotations fade in, then the page continues. The animation is a visual
 * simulation, labelled as such; it is not live mining data.
 */
export function Hero() {
  const section = useRef<HTMLElement>(null);
  const scrollRef = useRef(0);
  const q = useQuality();
  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end start"] });
  useEffect(() => scrollYProgress.on("change", (v) => (scrollRef.current = Math.min(1, v * 1.4))), [scrollYProgress]);

  const titleOpacity = useTransform(scrollYProgress, [0, 0.35], [1, 0]);
  const titleY = useTransform(scrollYProgress, [0, 0.35], [0, -60]);
  const annoOpacity = useTransform(scrollYProgress, [0.12, 0.3, 0.55, 0.7], [0, 1, 1, 0]);
  const fade = useTransform(scrollYProgress, [0.6, 0.85], [0, 1]);

  const canAnimate = q.webgl === true;

  return (
    <section ref={section} className="relative -mt-16 h-[150vh]" aria-label="Mine through the impossible">
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        {/* backdrop */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_45%,#0B1424_0%,#05070B_70%)]" />
        <div className="grid-backdrop absolute inset-0 opacity-50" />
        {canAnimate ? (
          <AcceleratorRing
            mode="decorative"
            scrollRef={scrollRef}
            particles={particleBudget(q.tier, 170)}
            dpr={q.dpr}
            reducedMotion={q.reducedMotion}
            className="absolute inset-0"
          />
        ) : q.webgl === false ? (
          <StaticAccelerator className="absolute inset-0 m-auto h-[70%] w-[90%] max-w-4xl opacity-90" />
        ) : null}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-bg to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-bg/80 to-transparent" />

        {/* technical annotations (desktop) */}
        <motion.div style={{ opacity: annoOpacity }} className="pointer-events-none absolute inset-0 hidden md:block">
          <Annotation className="left-[8%] top-[30%]" label="STORAGE RING" detail="particles circulate before reaching the barrier" />
          <Annotation className="right-[9%] top-[26%]" label="POTENTIAL BARRIER · V₀" detail="transmission T = [1 + V₀² sinh²(κa) / 4E(V₀−E)]⁻¹" align="right" />
          <Annotation className="right-[14%] bottom-[24%]" label="TRANSMISSION ZONE" detail="tunneled particles continue · reflected ones return" align="right" />
          <Annotation className="left-[12%] bottom-[26%]" label="QUANTUM CORE" detail="energy conduits · dipole magnets" />
        </motion.div>

        {/* headline */}
        <motion.div style={{ opacity: titleOpacity, y: titleY }} className="absolute inset-x-0 bottom-0 pb-[12vh] sm:pb-[14vh]">
          <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
            <div className="eyebrow flex items-center gap-3">
              <span className="inline-block h-px w-8 bg-cyan/70" />
              TUNNEL / QUANTUM EXPERIMENT 001
            </div>
            <h1 className="display mt-6 text-[clamp(44px,8.4vw,128px)]">
              <span className="block">MINE THROUGH</span>
              <span className="block bg-[linear-gradient(95deg,#F3F7FA_0%,#EAFBFF_35%,#00D9FF_70%,#885BFF_100%)] bg-clip-text text-transparent">
                THE IMPOSSIBLE.
              </span>
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
        <motion.div style={{ opacity: titleOpacity }} className="absolute bottom-5 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 sm:flex">
          <span className="font-mono text-[10px] tracking-[0.24em] text-faint">SCROLL</span>
          <span className="relative h-8 w-px overflow-hidden bg-line">
            <span className="scan-line absolute inset-x-0 top-0 h-3 bg-cyan" />
          </span>
        </motion.div>
        <motion.div style={{ opacity: fade }} className="pointer-events-none absolute inset-0 bg-bg" />
      </div>
    </section>
  );
}

function Annotation({ label, detail, className, align = "left" }: { label: string; detail: string; className: string; align?: "left" | "right" }) {
  return (
    <div className={`absolute max-w-[260px] ${className} ${align === "right" ? "text-right" : ""}`}>
      <div className={`flex items-center gap-2 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <span className="size-1.5 rounded-full bg-cyan shadow-[0_0_10px_#00D9FF]" />
        <span className="h-px w-10 bg-cyan/50" />
        <span className="font-mono text-[10.5px] tracking-[0.2em] text-cyan">{label}</span>
      </div>
      <div className="mt-1.5 font-mono text-[10.5px] leading-relaxed text-muted">{detail}</div>
    </div>
  );
}
