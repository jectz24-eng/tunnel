"use client";

import { BARRIER_META, formatBps, type BarrierParams } from "@tunnel/sdk";
import { useEffect, useRef, useState } from "react";
import { ChamberEngine, type ChamberCounters, type LaneSpec } from "./engine";

const THICKNESS = [0.006, 0.016, 0.034];

export interface ChamberResolution {
  /** Unique per settled round, so a resolution is animated exactly once. */
  key: string;
  /** outcomes[barrier] = per-particle fate, derived from onchain randomness. */
  outcomes: boolean[][];
}

interface Props {
  mode: "illustrative" | "live";
  barriers: BarrierParams[];
  queued?: number[];
  resolution?: ChamberResolution | null;
  className?: string;
  /** Top-left caption, e.g. "Round 1,204 · awaiting randomness". */
  caption?: React.ReactNode;
  compactLabels?: boolean;
  onCounters?: (c: ChamberCounters) => void;
}

export function TunnelingChamber({ mode, barriers, queued, resolution, className, caption, compactLabels, onCounters }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<ChamberEngine | null>(null);
  const played = useRef<string | null>(null);
  const [counters, setCounters] = useState<ChamberCounters | null>(null);

  const lanes: LaneSpec[] = barriers.map((b, i) => ({
    transmissionBps: b.transmissionBps,
    color: BARRIER_META[i]?.color ?? "#31D9F5",
    thickness: THICKNESS[i] ?? 0.02,
  }));
  const lanesKey = lanes.map((l) => l.transmissionBps).join(",");

  useEffect(() => {
    if (!canvas.current || !wrap.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const narrow = window.innerWidth < 640;
    const e = new ChamberEngine(canvas.current, lanes, mode, {
      reducedMotion: reduced,
      density: narrow ? 0.55 : 1,
      maxQueuedPerLane: narrow ? 24 : 60,
      seed: 0x7ae1,
    });
    e.onCounters = (c) => {
      setCounters({ transmitted: [...c.transmitted], reflected: [...c.reflected] });
      onCounters?.(c);
    };
    engine.current = e;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      e.resize(Math.max(1, width), Math.max(1, height));
    });
    ro.observe(wrap.current);
    const io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? e.start() : e.stop()), { threshold: 0.01 });
    io.observe(wrap.current);
    return () => {
      ro.disconnect();
      io.disconnect();
      e.destroy();
      engine.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    engine.current?.setLanes(lanes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanesKey]);

  useEffect(() => {
    if (mode === "live" && queued) engine.current?.setQueued(queued);
  }, [mode, queued?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== "live" || !resolution || played.current === resolution.key) return;
    played.current = resolution.key;
    engine.current?.playResolution(resolution.outcomes);
  }, [mode, resolution]);

  return (
    <div ref={wrap} className={`relative overflow-hidden ${className ?? ""}`}>
      <canvas ref={canvas} className="absolute inset-0 block" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0">
        {caption && <div className="absolute left-4 top-3 font-mono text-[11px] tracking-wide text-muted">{caption}</div>}
        {/* detectors */}
        <div className="absolute bottom-3 left-4 font-mono text-[10px] tracking-[0.12em] text-red/70">D·R reflected</div>
        <div className="absolute bottom-3 right-4 font-mono text-[10px] tracking-[0.12em] text-green/80">transmitted D·T</div>
        {/* lane annotations */}
        {barriers.map((b, i) => {
          const band = 84 / barriers.length;
          const top = `${8 + band * (i + 0.5) - band * 0.4}%`;
          return (
            <div key={i} className="absolute flex items-start" style={{ top, left: "calc(56% + 30px)" }}>
              <div className="font-mono text-[10.5px] leading-tight">
                <div style={{ color: BARRIER_META[i]?.color }} className="tracking-[0.14em]">
                  {compactLabels ? BARRIER_META[i]?.numeral : `BARRIER ${BARRIER_META[i]?.numeral}`}
                </div>
                <div className="text-muted">
                  T {formatBps(b.transmissionBps)}
                  {!compactLabels && <span className="text-faint"> · w×{b.rewardWeight}</span>}
                </div>
                {counters && (counters.transmitted[i] > 0 || counters.reflected[i] > 0) && (
                  <div className="tabular text-faint">
                    <span className="text-green/80">{counters.transmitted[i]}</span> / <span className="text-red/70">{counters.reflected[i]}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
