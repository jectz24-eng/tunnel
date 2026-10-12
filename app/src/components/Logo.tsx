/* eslint-disable @next/next/no-img-element */

/**
 * TUNNEL mark: a wave packet meets an energy barrier; the transmitted part of
 * the wave continues on the far side. `screen` blending drops the artwork's
 * black background so the glow sits directly on the page.
 */
export function LogoMark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/brand/tunnel-logo-mark-512.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      decoding="async"
      className={`shrink-0 mix-blend-screen ${className ?? ""}`}
      style={{ width: size, height: size }}
    />
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={34} className="-my-1" />
      <span className="flex flex-col leading-none">
        <span className="text-[13px] font-semibold tracking-[0.34em] text-fg">TUNNEL</span>
        <span className="mt-1 hidden font-mono text-[8.5px] tracking-[0.22em] text-faint sm:block">QUANTUM TUNNELING PROTOCOL</span>
      </span>
    </span>
  );
}
