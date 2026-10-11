/**
 * Static SVG accelerator, used when WebGL is unavailable. Same composition as
 * the 3D ring: storage ring, dipole magnets, quantum core, potential barrier.
 */
export function StaticAccelerator({ className }: { className?: string }) {
  const magnets = Array.from({ length: 36 }, (_, i) => (i / 36) * Math.PI * 2).filter((t) => Math.abs(t - 1.13) > 0.22);
  return (
    <svg viewBox="-60 -32 120 64" className={className} role="img" aria-label="Illustration of the TUNNEL particle accelerator">
      <defs>
        <radialGradient id="sa-core">
          <stop offset="0" stopColor="#EAFBFF" />
          <stop offset="0.3" stopColor="#00D9FF" stopOpacity="0.6" />
          <stop offset="1" stopColor="#00D9FF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sa-barrier" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#885BFF" stopOpacity="0" />
          <stop offset="0.5" stopColor="#885BFF" stopOpacity="0.8" />
          <stop offset="1" stopColor="#885BFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ellipse cx="0" cy="0" rx="46" ry="16" fill="none" stroke="#1f3247" strokeWidth="0.25" />
      <ellipse cx="0" cy="0" rx="40" ry="13.5" fill="none" stroke="#2864FF" strokeWidth="0.9" opacity="0.8" />
      <ellipse cx="0" cy="0" rx="40" ry="13.5" fill="none" stroke="#00D9FF" strokeWidth="0.35" strokeDasharray="6 30" />
      <ellipse cx="0" cy="0" rx="32" ry="10.6" fill="none" stroke="#182638" strokeWidth="0.25" />
      {magnets.map((t, i) => (
        <rect key={i} x={Math.cos(t) * 40 - 0.9} y={Math.sin(t) * 13.5 - 1.3} width="1.8" height="2.6" rx="0.3" fill="#0d1520" stroke="#1d2c40" strokeWidth="0.2" />
      ))}
      {[0.3, 1.35, 2.4, 3.4, 4.45, 5.5].map((t, i) => (
        <line key={i} x1="0" y1="0" x2={Math.cos(t) * 38} y2={Math.sin(t) * 12.8} stroke="#2864FF" strokeWidth="0.2" opacity="0.6" />
      ))}
      <circle cx="0" cy="0" r="6" fill="url(#sa-core)" />
      <rect x={Math.cos(1.13) * 40 - 1.6} y={Math.sin(1.13) * 13.5 - 9} width="3.2" height="18" fill="url(#sa-barrier)" />
      <circle cx={Math.cos(0.7) * 40} cy={Math.sin(0.7) * 13.5} r="0.9" fill="#00D9FF" />
      <circle cx={Math.cos(1.5) * 40} cy={Math.sin(1.5) * 13.5} r="0.9" fill="#EAFBFF" />
    </svg>
  );
}
