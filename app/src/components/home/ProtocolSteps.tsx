import type { ReactNode } from "react";
import { SectionHeading } from "../ui";

const STEPS: { n: string; title: string; body: string; icon: ReactNode }[] = [
  {
    n: "01",
    title: "Receive particle energy",
    body: "Every wallet gets a free energy allowance each 10-minute cycle. Spending it costs no SOL; unused energy expires when the cycle ends.",
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
    title: "Choose a barrier",
    body: "Low, medium or high. Pick a particle energy too: more energy per particle raises its tunneling probability and lowers the reward per success.",
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
    title: "Let randomness decide",
    body: "When the cycle closes, a pre-committed seed and a future Solana blockhash supply the randomness. Each particle's draw is compared with its physics-derived probability.",
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
    title: "Claim what tunneled",
    body: "Successful particles earn $TUNNEL from a fixed, pre-funded reserve, capped per cycle. Claim any time with a free signature; TUNNEL sends the tokens and pays the fee.",
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
        <SectionHeading eyebrow="02 / The protocol" title={<span id="protocol-title">Turn probability into participation.</span>}>
          The physics model sets the odds, a verifiable random draw decides each particle, the program enforces every rule, and the interface only shows
          outcomes after they are settled. Four separate parts, each independently checkable.
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
          <div><span className="text-cyan">PHYSICS</span> → probability per particle</div>
          <div><span className="text-violet">Seed + blockhash</span> → individual outcome</div>
          <div><span className="text-ion">PROGRAM</span> → rules, caps, payouts</div>
          <div><span className="text-flare">INTERFACE</span> → shows confirmed results</div>
        </div>
      </div>
    </section>
  );
}
