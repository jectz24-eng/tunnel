/**
 * TUNNEL mark: a wave packet approaching an energy barrier from the left; the
 * part of the wave that tunnels continues, attenuated, on the far side.
 */
export function LogoMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="tn-barrier" x1="0" y1="4" x2="0" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9B75FF" stopOpacity="0" />
          <stop offset="0.5" stopColor="#9B75FF" />
          <stop offset="1" stopColor="#9B75FF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="tn-wave" x1="2" y1="0" x2="30" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#31D9F5" stopOpacity="0.15" />
          <stop offset="0.45" stopColor="#31D9F5" />
          <stop offset="0.62" stopColor="#4378FF" />
          <stop offset="1" stopColor="#45E6B0" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <rect x="15" y="4" width="3.2" height="24" rx="1" fill="url(#tn-barrier)" opacity="0.9" />
      <path
        d="M2 16c1.6 0 2.1-6 3.9-6s2.4 12 4.3 12 2.4-9.5 4.1-9.5c.5 0 .8.9 1 3.5M18.6 16c.4-1.3.8-2 1.4-2 1 0 1.3 4 2.4 4s1.3-3 2.3-3 1.2 2 2 2 1.3-1 1.3-1"
        stroke="url(#tn-wave)"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="28.7" cy="16" r="1.5" fill="#45E6B0" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[13px] font-semibold tracking-[0.32em] text-fg">TUNNEL</span>
    </span>
  );
}
