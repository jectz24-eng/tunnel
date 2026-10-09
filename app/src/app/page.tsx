import { BarrierCards } from "@/components/home/BarrierCards";
import { HeroChamber } from "@/components/home/HeroChamber";
import { ProtocolStats } from "@/components/home/ProtocolStats";
import { ButtonLink } from "@/components/ui";

const STEPS = [
  {
    n: "01",
    title: "Select a barrier",
    body: "Three energy barriers with fixed, published transmission probabilities and reward weights. Higher barriers tunnel less often and weigh more.",
  },
  {
    n: "02",
    title: "Deploy particles",
    body: "Each particle costs 0.01 SOL and is one mining attempt. Your SOL goes into the round's program-controlled escrow, never to a person.",
  },
  {
    n: "03",
    title: "The round resolves",
    body: "After 60 seconds deposits close, ORAO VRF supplies randomness, and every particle's fate is derived onchain. Successful particles share 95% of the pool and the round's $TUNNEL emission.",
  },
];

const PIPELINE = [
  ["Deposits close", "close_ts reached; no further deposits accepted"],
  ["Seed fixed", "sha256(round ‖ latest slot hash)"],
  ["ORAO VRF", "64-byte randomness, quorum-signed"],
  ["Per-particle draw", "sha256(randomness ‖ round ‖ owner ‖ barrier ‖ i)"],
  ["Outcome", "draw < ⌊p · 2⁶⁴⌋ ⇒ transmitted"],
];

export default function Home() {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_50%_at_50%_0%,rgba(67,120,255,0.10),transparent_70%)]" />
      <section className="relative mx-auto max-w-[1400px] px-4 pt-14 sm:px-6 sm:pt-20">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="label mb-5 flex items-center gap-2 text-cyan">
              <span className="h-px w-6 bg-cyan" /> Quantum-inspired mining protocol
            </div>
            <h1 className="text-[40px] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-[56px] lg:text-[64px]">
              Mine through
              <br />
              the impossible.
            </h1>
            <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-muted sm:text-[17px]">
              Deploy particles. Challenge quantum barriers. Mine $TUNNEL on Solana.
            </p>
          </div>
          <div className="flex flex-col gap-4 lg:items-end">
            <div className="flex gap-3">
              <ButtonLink href="/mine" variant="primary" size="lg">
                Start Mining
              </ButtonLink>
              <ButtonLink href="/protocol" size="lg">
                Explore Protocol
              </ButtonLink>
            </div>
            <div className="font-mono text-[11.5px] tracking-wide text-muted">
              Quantum-inspired mining <span className="text-faint">·</span> Onchain settlement <span className="text-faint">·</span> Verifiable outcomes
            </div>
          </div>
        </div>
        <div className="mt-10">
          <HeroChamber />
        </div>
        <div className="mt-4">
          <ProtocolStats />
        </div>
      </section>

      <section className="mx-auto mt-28 max-w-[1400px] px-4 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <div className="label text-cyan">How mining works</div>
            <h2 className="mt-3 text-[28px] font-semibold leading-tight tracking-[-0.02em]">A barrier, a particle, a probability.</h2>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">
              In quantum mechanics a particle can cross a barrier it classically cannot. TUNNEL turns that idea into a transparent game of chance with
              published odds, settled entirely by a Solana program.
            </p>
          </div>
          <div className="grid gap-px overflow-hidden rounded-[14px] border border-line bg-line-soft sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="bg-panel p-6">
                <div className="font-mono text-[11px] text-faint">{s.n}</div>
                <div className="mt-6 text-[15px] font-medium">{s.title}</div>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto mt-24 max-w-[1400px] px-4 sm:px-6">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <div className="label text-cyan">Energy barriers</div>
            <h2 className="mt-3 text-[28px] font-semibold tracking-[-0.02em]">Published odds. Snapshotted per round.</h2>
          </div>
          <p className="hidden max-w-sm text-right text-[13px] leading-relaxed text-muted md:block">
            Parameters are fixed into each round before it accepts deposits. Changes apply only to future rounds.
          </p>
        </div>
        <BarrierCards />
      </section>

      <section className="mx-auto mt-24 max-w-[1400px] px-4 sm:px-6">
        <div className="panel overflow-hidden">
          <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
            <div className="border-b border-line-soft p-8 lg:border-b-0 lg:border-r">
              <div className="label text-cyan">Verifiable outcomes</div>
              <h2 className="mt-3 text-[24px] font-semibold tracking-[-0.02em]">Nothing is decided by this website.</h2>
              <p className="mt-4 text-[14.5px] leading-relaxed text-muted">
                Randomness comes from ORAO VRF and is requested only after deposits close. Each particle&apos;s outcome is a deterministic function of
                that randomness, so anyone can recompute every result of every round from public chain data.
              </p>
              <div className="mt-6 flex gap-3">
                <ButtonLink href="/docs#randomness" size="sm">
                  Verification procedure
                </ButtonLink>
                <ButtonLink href="/docs#risks" size="sm" variant="ghost">
                  Risk disclosures
                </ButtonLink>
              </div>
            </div>
            <ol className="p-8">
              {PIPELINE.map(([t, d], i) => (
                <li key={t} className="relative flex gap-4 pb-5 last:pb-0">
                  {i < PIPELINE.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-line" />}
                  <span className="relative mt-1.5 size-[11px] shrink-0 rounded-full border border-cyan/60 bg-bg" />
                  <div>
                    <div className="text-[14px] font-medium">{t}</div>
                    <div className="mt-0.5 font-mono text-[11.5px] text-muted">{d}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-3xl text-center text-xs leading-relaxed text-faint">
          TUNNEL is a quantum-inspired stochastic protocol. It does not use quantum hardware. Committing SOL can result in the loss of some or all of
          it; a successful tunnel does not guarantee receiving more SOL than you deposited. Smart contracts have not been independently audited.
        </p>
      </section>
    </div>
  );
}
