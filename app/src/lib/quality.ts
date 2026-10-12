"use client";

import { useEffect, useState } from "react";

export type QualityTier = "high" | "medium" | "low";

export interface Quality {
  /** null until measured on the client. */
  webgl: boolean | null;
  reducedMotion: boolean;
  tier: QualityTier;
  /** Device pixel ratio cap for WebGL canvases. */
  dpr: [number, number];
  mobile: boolean;
}

const SSR: Quality = { webgl: null, reducedMotion: false, tier: "medium", dpr: [1, 1.5], mobile: false };

function detectWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Adaptive quality: fewer particles and a lower pixel ratio on small or low-power devices. */
export function useQuality(): Quality {
  const [q, setQ] = useState<Quality>(SSR);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      const mobile = window.matchMedia("(max-width: 767px)").matches || navigator.maxTouchPoints > 1;
      const cores = navigator.hardwareConcurrency ?? 4;
      const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
      const tier: QualityTier = mobile || cores <= 4 || memory <= 4 ? (mobile && cores <= 4 ? "low" : "medium") : "high";
      setQ({
        webgl: detectWebGL(),
        // `?motion=force` overrides the OS setting (for testing and screenshots).
        reducedMotion: mq.matches && !new URLSearchParams(window.location.search).has("motion"),
        tier,
        // Render at the display's full pixel density (capped at 2x) so edges and glow stay crisp.
        dpr: tier === "low" ? [1, 1.5] : [1, 2],
        mobile,
      });
    };
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return q;
}

/** Particle budget per quality tier. */
export const particleBudget = (tier: QualityTier, high: number) => (tier === "high" ? high : tier === "medium" ? Math.round(high * 0.55) : Math.round(high * 0.3));
