"use client";

import { psiAt, solveBarrier, waveComponents } from "@tunnel/sdk";
import { useEffect, useMemo, useRef } from "react";

export interface WaveCanvasProps {
  /** Particle energy, barrier height and width in normalized units (ħ²/2m = 1). */
  e: number;
  v0: number;
  a: number;
  /** Draw incident / reflected / transmitted components separately. */
  components?: boolean;
  /** Show |ψ|² shading. */
  density?: boolean;
  className?: string;
  reducedMotion?: boolean;
  /** Fixed vertical energy scale (defaults to fitting max(E, V₀)). */
  energyMax?: number;
}

const COLORS = {
  re: "#00D9FF",
  density: "rgba(0, 217, 255, 0.10)",
  envelope: "rgba(234, 251, 255, 0.55)",
  incident: "#2864FF",
  reflected: "#F0A64B",
  transmitted: "#EAFBFF",
  barrierFill: "rgba(136, 91, 255, 0.10)",
  barrierEdge: "rgba(136, 91, 255, 0.85)",
  grid: "rgba(26, 37, 50, 0.6)",
  energy: "rgba(129, 144, 159, 0.7)",
  label: "#81909F",
};

/**
 * Animated stationary-state wavefunction for a rectangular barrier, computed
 * exactly (matching ψ and ψ' at both edges). Drawn on an energy diagram: the
 * barrier is a box of height V₀, and the wave oscillates about the line at E.
 * Inside the barrier (E < V₀) the amplitude decays exponentially; what
 * remains on the far side is the transmitted wave, with |t|² = T.
 */
export function WaveCanvas({ e, v0, a, components = false, density = true, className, reducedMotion, energyMax }: WaveCanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sol = useMemo(() => solveBarrier(Math.max(1e-4, e), v0, a), [e, v0, a]);
  const params = useRef({ sol, components, density, energyMax });
  params.current = { sol, components, density, energyMax };

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver(([en]) => (visible = en.isIntersecting));
    io.observe(c);

    const draw = (time: number) => {
      const { sol: s, components: comps, density: dens, energyMax: eMax } = params.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Horizontal span: a few wavelengths either side of the barrier.
      const lambda = (2 * Math.PI) / s.k;
      const side = Math.min(14, Math.max(2.4, lambda * 2.6, s.a * 1.2));
      const x0 = -side;
      const x1 = s.a + side;
      const px = (x: number) => ((x - x0) / (x1 - x0)) * w;
      const top = 18;
      const bottom = h - 26;
      const eScale = eMax ?? Math.max(s.v0, s.e) * 1.45;
      const py = (en: number) => bottom - (en / eScale) * (bottom - top);
      const amp = Math.min((bottom - top) * 0.2, 46);

      // grid
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      for (let gx = 0; gx <= 12; gx++) {
        const X = Math.round((gx / 12) * w) + 0.5;
        ctx.beginPath();
        ctx.moveTo(X, top);
        ctx.lineTo(X, bottom);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(0, bottom + 0.5);
      ctx.lineTo(w, bottom + 0.5);
      ctx.strokeStyle = "rgba(129,144,159,0.35)";
      ctx.stroke();

      // barrier
      const bx0 = px(0);
      const bx1 = px(s.a);
      const by = py(s.v0);
      const grad = ctx.createLinearGradient(0, by, 0, bottom);
      grad.addColorStop(0, "rgba(136, 91, 255, 0.22)");
      grad.addColorStop(1, "rgba(136, 91, 255, 0.04)");
      ctx.fillStyle = grad;
      ctx.fillRect(bx0, by, bx1 - bx0, bottom - by);
      ctx.strokeStyle = COLORS.barrierEdge;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(0, bottom);
      ctx.lineTo(bx0, bottom);
      ctx.lineTo(bx0, by);
      ctx.lineTo(bx1, by);
      ctx.lineTo(bx1, bottom);
      ctx.lineTo(w, bottom);
      ctx.stroke();

      // energy level
      const ey = py(s.e);
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = COLORS.energy;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, ey);
      ctx.lineTo(w, ey);
      ctx.stroke();
      ctx.setLineDash([]);

      // labels
      ctx.font = "10.5px var(--font-geist-mono), ui-monospace, monospace";
      ctx.fillStyle = COLORS.label;
      ctx.fillText(`V₀ = ${s.v0.toFixed(2)}`, bx1 + 6, by + 12);
      ctx.fillText(`E = ${s.e.toFixed(2)}`, 6, ey - 6);
      ctx.fillText(`a = ${s.a.toFixed(2)}`, bx0, bottom + 16);

      // Reduced motion slows the wave down rather than freezing it.
      const phase = (time / 1000) * (reducedMotion ? 0.7 : 2.2);
      const N = Math.max(200, Math.round(w));
      const xs = Array.from({ length: N }, (_, i) => x0 + ((x1 - x0) * i) / (N - 1));
      const psi = xs.map((x) => psiAt(s, x, phase));

      // |ψ|² shading about the energy line
      if (dens) {
        ctx.beginPath();
        xs.forEach((x, i) => {
          const y = ey - psi[i].abs2() * amp * 0.5;
          if (i === 0) ctx.moveTo(px(x), y);
          else ctx.lineTo(px(x), y);
        });
        ctx.lineTo(px(x1), ey);
        ctx.lineTo(px(x0), ey);
        ctx.closePath();
        ctx.fillStyle = COLORS.density;
        ctx.fill();
        // envelope |ψ|
        ctx.beginPath();
        xs.forEach((x, i) => {
          const y = ey - Math.sqrt(psi[i].abs2()) * amp;
          if (i === 0) ctx.moveTo(px(x), y);
          else ctx.lineTo(px(x), y);
        });
        ctx.strokeStyle = COLORS.envelope;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const line = (pts: [number, number][], color: string, width: number, glow = 0) => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.shadowColor = color;
        ctx.shadowBlur = glow;
        ctx.stroke();
        ctx.shadowBlur = 0;
      };

      if (comps) {
        const inc: [number, number][] = [];
        const ref: [number, number][] = [];
        const tra: [number, number][] = [];
        xs.forEach((x) => {
          const c3 = waveComponents(s, x, phase);
          if (c3.incident) inc.push([px(x), ey - c3.incident.re * amp]);
          if (c3.reflected) ref.push([px(x), ey - c3.reflected.re * amp]);
          if (c3.transmitted) tra.push([px(x), ey - c3.transmitted.re * amp]);
        });
        line(inc, COLORS.incident, 1.3);
        line(ref, COLORS.reflected, 1.3);
        line(tra, COLORS.transmitted, 1.6, 6);
        // inside the barrier: the full solution
        const inside = xs.map((x, i) => [x, psi[i]] as const).filter(([x]) => x >= 0 && x <= s.a);
        line(inside.map(([x, p]) => [px(x), ey - p.re * amp]), COLORS.re, 1.6, 6);
      } else {
        line(xs.map((x, i) => [px(x), ey - psi[i].re * amp]), COLORS.re, 1.6, 8);
      }

      if (visible) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const ro = new ResizeObserver(() => reducedMotion && requestAnimationFrame(draw));
    ro.observe(c);
    // resume when scrolled back into view
    const resume = setInterval(() => {
      if (visible) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(draw);
      }
    }, 1000);
    // Static redraw when inputs change under reduced motion.
    if (reducedMotion) requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(resume);
      io.disconnect();
      ro.disconnect();
    };
  }, [reducedMotion, sol, components, density, energyMax]);

  return (
    <canvas
      ref={canvas}
      className={className}
      role="img"
      aria-label={`Wavefunction for E = ${e.toFixed(2)}, V₀ = ${v0.toFixed(2)}, a = ${a.toFixed(2)}: transmission probability ${(sol.T * 100).toFixed(2)}%`}
    />
  );
}
