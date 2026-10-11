"use client";

import { useThree } from "@react-three/fiber";
import { useEffect, useState } from "react";

/**
 * Testing aid: `?raf=interval` drives R3F from a timer instead of
 * requestAnimationFrame (headless or hidden browsers never fire rAF, which
 * would leave canvases blank in automated screenshots). No effect otherwise.
 */
export function useTimerDriven() {
  const [timer, setTimer] = useState(false);
  useEffect(() => setTimer(new URLSearchParams(window.location.search).get("raf") === "interval"), []);
  return timer;
}

export function TimerDriver({ fps = 30, active = true }: { fps?: number; active?: boolean }) {
  const advance = useThree((s) => s.advance);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => advance(performance.now()), 1000 / fps);
    return () => clearInterval(id);
  }, [advance, fps, active]);
  return null;
}
