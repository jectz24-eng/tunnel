import type { Metadata } from "next";
import Link from "next/link";
import { DeploymentStatus } from "./DeploymentStatus";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "How it works",
  description: "How TUNNEL turns quantum tunneling into a mining experience: energy, barriers, physics-derived odds, provably fair randomness, cycles, rewards and claims.",
};

const LIFECYCLE = [
  ["Open", "A cycle opens with a snapshot of barriers, odds, energy allowance and its $TUNNEL budget.", "#00D9FF"],
  ["Deploy", "Wallets spend free energy on experiments: particles × barrier × energy level.", "#00D9FF"],
  ["Close", "At the deadline deployments stop. The entropy block chosen at open has not been produced yet.", "#F0A64B"],
  ["Randomness", "Seed (committed at open) + that future Solana blockhash → 64 random bytes.", "#885BFF"],
  ["Settle", "Every particle is drawn from the randomness; the seed is revealed so anyone can recheck.", "#2864FF"],
  ["Finalize", "Payout = nominal rewards, scaled down pro rata if they exceed the cycle budget.", "#EAFBFF"],
  ["Claim", "Sign a free message; TUNNEL sends your $TUNNEL on Solana and pays the fee.", "#EAFBFF"],
] as const;

export default function HowItWorksPage() {
  return (
    <>
      <PageHeader eyebrow="How it works" title={<>From equation to outcome.</>}>
        TUNNEL separates four things that are often blurred together: the physics that sets probabilities, the randomness that decides outcomes, the
        server that enforces the rules, and the public records that let anyone check what was settled.
      </PageHeader>

      <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6">
        {/* lifecycle */}
        <section aria-labelledby="lifecycle">
          <h2 id="lifecycle" className="text-2xl font-semibold tracking-tight">
            One cycle, start to finish
          </h2>
          <ol className="relative mt-8 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-7">
            {LIFECYCLE.map(([title, body, color], i) => (
              <li key={title} className="relative bg-panel p-5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                  <span className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
                </div>
                <h3 className="mt-4 font-mono text-[13px] uppercase tracking-[0.14em]" style={{ color }}>
                  {title}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-muted">
            The TUNNEL engine runs every step on schedule. It cannot steer outcomes: its seed is locked in before anyone deploys, and the blockhash that
            completes the randomness does not exist until deployments have closed. If the entropy block cannot be read for an hour, the cycle is voided:
            it pays nothing and its budget returns to the reserve.
          </p>
        </section>

        <div className="prose-doc mt-16 grid gap-x-16 lg:grid-cols-2">
          <section className="min-w-0">
            <h2 id="energy">Energy, not money</h2>
            <p>
              Each wallet receives a fixed particle-energy allowance every cycle (100 units at launch). An experiment spends <code>particles × cost</code>,
              where the cost is 1–5 depending on the particle energy you choose. Unused energy expires when the cycle ends.
            </p>
            <p>
              Mining is completely free. Deploying particles and claiming rewards are <b>signed messages</b>, not transactions: your wallet shows the exact
              text, nothing moves, and there are no network fees. When you claim, TUNNEL sends your $TUNNEL on Solana from its reward wallet and pays that
              fee itself. You never need SOL to play. TUNNEL never asks for your seed phrase or private key.
            </p>

            <h2 id="physics">The physics sets the odds</h2>
            <p>
              Each barrier is a real rectangular potential: a height V₀ and a width a. Your particle&apos;s energy is a fraction of V₀ (20–80%), so every
              success is genuine sub-barrier tunneling. TUNNEL evaluates
            </p>
            <pre>
              <code>T = [1 + V₀² sinh²(κa) / (4E(V₀ − E))]⁻¹,  κ = √(2m(V₀ − E))/ħ</code>
            </pre>
            <p>
              itself whenever parameters change, in units where ħ²/2m = 1, and stores each probability in parts per billion. It also calibrates the
              reward per success as <code>cost × premium ÷ probability</code>, so the expected reward per unit of energy is the same at every energy level of
              a barrier. Your choice of energy trades frequency for size, not value. The higher barriers carry a small premium (95% / 100% / 105%) for
              their variance. See the <Link href="/laboratory">laboratory</Link> to explore the model.
            </p>

            <h2 id="randomness">The randomness decides each particle</h2>
            <p>
              When a cycle opens, TUNNEL picks a secret 32-byte seed and immediately publishes its fingerprint,{" "}
              <code>sha256(&quot;TUNNEL/seed-commit/v3&quot; ‖ seed)</code>, together with an <b>entropy slot</b>: a Solana slot far enough in the future that
              its block cannot exist until deployments have closed. After close, the randomness is
            </p>
            <pre>
              <code>sha512(&quot;TUNNEL/cycle-randomness/v3&quot; ‖ seed ‖ blockhash ‖ cycle)</code>
            </pre>
            <p>
              using the first block produced at or after the entropy slot. Each particle&apos;s draw is then
            </p>
            <pre>
              <code>u64(sha256(&quot;TUNNEL/particle/v3&quot; ‖ randomness ‖ cycle ‖ wallet ‖ barrier ‖ level ‖ index)[0..8])</code>
            </pre>
            <p>
              and it tunnels when the draw is below <code>⌊p · 2⁶⁴⌋</code>, with no modulo bias. After settlement the seed is revealed. Anyone can check it
              against the published fingerprint, fetch the blockhash from any Solana explorer, and recompute every outcome; the{" "}
              <Link href="/history">history</Link> pages do it in your browser.
            </p>
            <h3>Trust assumptions</h3>
            <ul>
              <li>The seed is fixed before anyone deploys, so the server cannot change it to favour or punish anyone. The blockhash is chosen by the Solana network.</li>
              <li>
                Nobody, including TUNNEL, can know an outcome while deployments are open, because the entropy block does not exist yet. Deployments are
                also refused once the chain gets close to the entropy slot.
              </li>
              <li>
                TUNNEL runs the game on its own server rather than a smart contract. It records every signed deployment and publishes everything needed
                to verify settlements, but you are trusting it to keep running, to settle every cycle, and to honour claims from its reward wallet.
              </li>
            </ul>
          </section>

          <section className="min-w-0">
            <h2 id="rewards">Rewards from a fixed reserve</h2>
            <p>
              TUNNEL never mints $TUNNEL. Rewards come from a reserve deposited in advance into the TUNNEL reward wallet, whose balance anyone can check on
              Solana. Cycles can only budget what has been deposited. Each cycle reserves a budget (initially 20,000 $TUNNEL, decaying 0.5% per day of cycles), capped by what remains in the
              reserve. If the cycle&apos;s nominal rewards exceed the budget, every payout is scaled down by the same factor. Unused budget returns to the
              reserve.
            </p>
            <p>
              Rewards are probabilistic and limited. You may receive nothing. $TUNNEL has no guaranteed value, and nothing on this site is investment advice.
            </p>

            <h2 id="abuse">Abuse mitigation (and its limits)</h2>
            <p>
              Per-wallet energy limits do not stop one person from using many wallets. TUNNEL bounds the damage instead: emissions per cycle are capped
              regardless of how many wallets play, so splitting across wallets cannot extract more than the cycle budget. Deployments and claims are also
              rate-limited per wallet and per network.
            </p>

            <h2 id="authority">What the admin can and cannot do</h2>
            <ul>
              <li>Can: tune parameters for <i>future</i> cycles (odds are always re-derived from the physics), pause mining. Every change is written to a public audit log.</li>
              <li>Settled cycles are immutable records; changing one would break its published, independently checkable proof.</li>
              <li>The reward wallet is controlled by the operator. That is a trust assumption, stated here plainly.</li>
            </ul>

            <h2 id="deployment">Deployment status</h2>
            <DeploymentStatus />
            <p>
              TUNNEL has not been independently audited. Source, tests and the deployment checklist are in the repository.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
