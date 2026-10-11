/**
 * TUNNEL mark: a wave packet meets an energy barrier; the transmitted part of
 * the wave continues, attenuated, on the far side.
 */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="tn-barrier" x1="0" y1="3" x2="0" y2="29" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#885BFF" stopOpacity="0" />
          <stop offset="0.5" stopColor="#885BFF" />
          <stop offset="1" stopColor="#885BFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="tn-wave" x1="2" y1="0" x2="30" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#00D9FF" stopOpacity="0.2" />
          <stop offset="0.45" stopColor="#00D9FF" />
          <stop offset="0.62" stopColor="#2864FF" />
          <stop offset="1" stopColor="#EAFBFF" />
        </linearGradient>
      </defs>
      <rect x="14.6" y="3" width="3.4" height="26" rx="1" fill="url(#tn-barrier)" />
      <path
        d="M2 16c1.6 0 2.1-7 3.9-7s2.4 14 4.3 14 2.4-10.5 4.1-10.5c.5 0 .8.9 1 3.5M18.6 16c.4-1.3.8-2 1.4-2 1 0 1.3 4 2.4 4s1.3-3 2.3-3 1.2 2 2 2 1.3-1 1.3-1"
        stroke="url(#tn-wave)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="28.8" cy="16" r="1.6" fill="#EAFBFF" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="text-[13px] font-semibold tracking-[0.34em] text-fg">TUNNEL</span>
        <span className="mt-1 hidden font-mono text-[8.5px] tracking-[0.22em] text-faint sm:block">QUANTUM TUNNELING PROTOCOL</span>
      </span>
    </span>
  );
}
