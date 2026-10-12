"use client";

import Lenis from "lenis";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Inertial smooth scrolling (wheel and trackpad). Touch keeps the native feel.
 * With reduced motion the easing is shorter (less glide), never a long drift.
 */
export function SmoothScroll() {
  const lenis = useRef<Lenis | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const l = new Lenis({ lerp: reduced ? 0.2 : 0.09, wheelMultiplier: 0.9, smoothWheel: true, anchors: { offset: -80 } });
    lenis.current = l;
    let raf = 0;
    const loop = (t: number) => {
      l.raf(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      l.destroy();
      lenis.current = null;
    };
  }, []);

  // New page: start at the top instantly (no glide from the previous position).
  useEffect(() => {
    if (!location.hash) lenis.current?.scrollTo(0, { immediate: true });
  }, [pathname]);

  return null;
}
