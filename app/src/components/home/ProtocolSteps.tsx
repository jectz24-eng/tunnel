import type { ReactNode } from "react";
import { SectionHeading } from "../ui";

const STEPS: { n: string; title: string; body: string; icon: ReactNode }[] = [
  {
    n: "01",
    title: "Load the vault",
    body: "Connect your Solana wallet and deposit $TUNNEL. It lands in your balance in seconds and stays yours to withdraw any time.",
    icon: (
      <svg viewBox="0 0 48 48" className="size-12" aria-hidden="true">
        <circle cx="24" cy="24" r="17" fill="none" stroke="#1a2532" strokeWidth="2" />
        <path d="M24 7a17 17 0 0 1 14.7 25.5" fill="none" stroke="#00D9FF" strokeWidth="2" strokeLinecap="round" />
        <path d="M26 14l-6 11h6l-3 9 8-13h-6l3-7z" fill="#EAFBFF" />
      </svg>
    ),
  },
  {
    n: "02",
    title: "Pick your barrier",
    body: "Low, medium or high. The taller the wall, the rarer the tunnel and the bigger the multiplier when a particle breaks through.",
    icon: (
      <svg viewBox="0 0 48 48" className="size-12" aria-hidden="true">
        {[14, 22, 30].map((h, i) => (
          <rect key={i} x={10 + i * 11} y={40 - h} width="6" height={h} rx="1" fill={["#00D9FF", "#2864FF", "#885BFF"][i]} opacity={0.35 + i * 0.25} />
        ))}
        <path d="M4 32h40" stroke="#81909f" strokeDasharray="2 3" />
      </svg>
    ),
  },
  {
    n: "03",
    title: "Charge and fire",
    body: "Set the energy behind each particle and how many to fire at once. Every particle is its own shot at the barrier, decided instantly.",
    icon: (
      <svg viewBox="0 0 48 48" className="size-12" aria-hidden="true">
        <rect x="9" y="9" width="30" height="30" rx="7" fill="none" stroke="#885BFF" strokeWidth="2" />
        {[
          [18, 18],
          [30, 18],
          [24, 24],
          [18, 30],
          [30, 30],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2.4" fill={i === 2 ? "#EAFBFF" : "#885BFF"} />
        ))}
      </svg>
    ),
  },
  {
    n: "04",
    title: "Cash out",
    body: "Winnings hit your balance the moment the particles land. Withdraw to your wallet with one free signature; TUNNEL covers the network fee.",
    icon: (
      <svg viewBox="0 0 48 48" className="size-12" aria-hidden="true">
        <path d="M4 26c3 0 3.5-10 6.5-10S14 34 17 34s3.5-14 6-14" fill="none" stroke="#00D9FF" strokeWidth="2" strokeLinecap="round" />
        <rect x="24" y="8" width="5" height="32" rx="1" fill="#885BFF" opacity="0.6" />
        <path d="M31 24c1.5 0 2-3 3.5-3s2 6 3.5 6 2-3 3-3" fill="none" stroke="#EAFBFF" strokeWidth="2" strokeLinecap="round" />
        <circle cx="44" cy="24" r="2.6" fill="#EAFBFF" />
      </svg>
    ),
  },
];

/** THE PROTOCOL — turn probability into participation. */
export function ProtocolSteps() {
  return (
    <section id="protocol" className="relative scroll-mt-20 border-y border-line-soft bg-bg-2/40" aria-labelledby="protocol-title">
      <div className="fine-grid pointer-events-none absolute inset-0 opacity-30" />
      <div className="relative mx-auto max-w-[1400px] px-4 py-28 sm:px-6 sm:py-32">
        <SectionHeading eyebrow="02 / How it plays" title={<span id="protocol-title">Four steps from wallet to breakthrough.</span>}>
          No cycles to wait for, no forms to fill in. Load up, pick your barrier, fire, and watch every particle hit the wall in real time.
        </SectionHeading>
        <ol className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="group relative bg-panel p-7 transition-colors hover:bg-panel-2/70">
              <div className="flex items-start justify-between">
                {s.icon}
                <span className="font-mono text-[11px] tracking-[0.2em] text-faint">{s.n}</span>
              </div>
              <h3 className="mt-8 text-lg font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{s.body}</p>
              <span className="absolute inset-x-7 bottom-0 h-px origin-left scale-x-0 bg-cyan/60 transition-transform duration-500 group-hover:scale-x-100" />
            </li>
          ))}
        </ol>
        <div className="mt-8 grid gap-3 font-mono text-[11px] tracking-[0.06em] text-muted sm:grid-cols-4">
          <div><span className="text-cyan">BARRIER</span> → your volatility</div>
          <div><span className="text-violet">ENERGY</span> → your stake per particle</div>
          <div><span className="text-ion">PARTICLES</span> → shots fired at once</div>
          <div><span className="text-flare">PROVABLY FAIR</span> → every result verifiable</div>
        </div>
      </div>
    </section>
  );
}
