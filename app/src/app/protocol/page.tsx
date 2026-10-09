import type { Metadata } from "next";
import { LifecycleDiagram } from "@/components/protocol/LifecycleDiagram";
import { LiveParams } from "@/components/protocol/LiveParams";
import { ButtonLink, SectionHeading } from "@/components/ui";

export const metadata: Metadata = { title: "Protocol" };

const EXAMPLE = {
  pool: "1.00",
  fee: "0.05",
  dist: "0.95",
};

export default function ProtocolPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
      <SectionHeading eyebrow="Protocol" title="How a round works">
        Every 60 seconds a round opens, collects particles, closes, receives verifiable randomness and settles. Each step is a Solana program
        instruction; the website and the keeper service only submit them.
      </SectionHeading>

      <section className="mt-10 panel p-5 sm:p-6">
        <div className="label mb-4">Round lifecycle</div>
        <LifecycleDiagram />
      </section>

      <section className="mt-6">
        <LiveParams />
      </section>

      <section className="mt-16 grid gap-6 lg:grid-cols-2">
        <div className="panel p-6">
          <div className="label text-cyan">SOL settlement</div>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.01em]">Pooled, then split by weight</h2>
          <div className="mt-5 space-y-3 font-mono text-[12.5px] leading-relaxed text-fg-2">
            <div className="rounded-lg border border-line-soft bg-bg-2 p-3.5">
              fee = ⌊pool × 500 / 10 000⌋ <span className="text-faint">→ treasury</span>
              <br />
              distributable = pool − fee
              <br />
              weight(p) = Σ successes_b × weight_b
              <br />
              sol(p) = ⌊distributable × weight(p) / Σ weight⌋
            </div>
            <p className="font-sans text-[13.5px] text-muted">
              If no particle tunnels, the distributable 95% is refunded pro rata to each participant&apos;s deposit:{" "}
              <span className="font-mono text-fg-2">⌊distributable × deposit(p) / pool⌋</span>. If a round fails (randomness never arrives), every
              deposit is refunded in full with no fee.
            </p>
          </div>
        </div>
        <div className="panel p-6">
          <div className="label text-cyan">Worked example</div>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.01em]">A 1 SOL round</h2>
          <ul className="mt-5 space-y-2.5 text-[13.5px] text-muted">
            <li>
              Pool <span className="font-mono text-fg">{EXAMPLE.pool} SOL</span> → fee <span className="font-mono text-fg">{EXAMPLE.fee}</span>, distributable{" "}
              <span className="font-mono text-fg">{EXAMPLE.dist} SOL</span>
            </li>
            <li>
              Alice: 3 Barrier I successes → weight <span className="font-mono text-fg">3</span>
            </li>
            <li>
              Bob: 1 Barrier III success → weight <span className="font-mono text-fg">5</span>
            </li>
            <li>
              Carol: no successes → weight <span className="font-mono text-fg">0</span>
            </li>
            <li className="border-t border-line-soft pt-2.5">
              Alice receives <span className="font-mono text-fg">0.95 × 3/8 = 0.35625 SOL</span>, Bob <span className="font-mono text-fg">0.59375 SOL</span>, Carol{" "}
              <span className="font-mono text-fg">0</span>. The round&apos;s $TUNNEL emission splits 3 : 5 the same way.
            </li>
          </ul>
          <p className="mt-4 text-[12px] leading-relaxed text-amber/90">
            Whether a success is profitable depends on everyone else&apos;s deposits and luck in that round. Carol lost her entire deposit.
          </p>
        </div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-3">
        {[
          ["Escrow", "Deposits go to a per-round vault account owned by the program. No instruction transfers escrowed SOL to the admin; it leaves only as fee (5% to the configured treasury), claims, or rounding dust after every claim."],
          ["Parameter snapshots", "Odds, weights, fee, particle cost and the $TUNNEL budget are copied into the round when it is opened, before it can accept deposits. Admin updates apply only to future rounds."],
          ["Liveness", "Closing, randomness requests, reveals, settlement, finalization and sweeping are all permissionless. If randomness stalls past the timeout, anyone can move the round to FAILED and every deposit becomes refundable."],
        ].map(([t, d]) => (
          <div key={t} className="panel p-6">
            <h3 className="text-[15px] font-medium">{t}</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{d}</p>
          </div>
        ))}
      </section>

      <div className="mt-12 flex flex-wrap gap-3">
        <ButtonLink href="/mine" variant="primary">
          Open the mining terminal
        </ButtonLink>
        <ButtonLink href="/docs">Read the documentation</ButtonLink>
      </div>
    </div>
  );
}
