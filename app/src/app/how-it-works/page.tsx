import type { Metadata } from "next";
import Link from "next/link";
import { DeploymentStatus } from "./DeploymentStatus";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "How it works",
  description: "How TUNNEL turns quantum tunneling into a mining experience: energy, barriers, physics-derived odds, ORAO verifiable randomness, cycles, rewards and claims.",
};

const LIFECYCLE = [
  ["Open", "A cycle opens with a snapshot of barriers, odds, energy allowance and its $TUNNEL budget.", "#00D9FF"],
  ["Deploy", "Wallets spend free energy on experiments: particles × barrier × energy level.", "#00D9FF"],
  ["Close", "At the deadline the VRF seed is fixed from the newest slot hash. No more particles.", "#F0A64B"],
  ["Randomness", "ORAO VRF fulfils 64 random bytes for that seed, signed by its authorities.", "#885BFF"],
  ["Settle", "The program draws every particle from the randomness and counts tunnels per position.", "#2864FF"],
  ["Finalize", "Payout = nominal rewards, scaled down pro rata if they exceed the cycle budget.", "#EAFBFF"],
  ["Claim", "Wallets claim rewards (if any); the position closes and its deposit is returned.", "#EAFBFF"],
] as const;

export default function HowItWorksPage() {
  return (
    <>
      <PageHeader eyebrow="How it works" title={<>From equation to outcome.</>}>
        TUNNEL separates four things that are often blurred together: the physics that sets probabilities, the randomness that decides outcomes, the
        program that enforces the rules, and the interface that shows what was settled.
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
            Every arrow is a program instruction anyone can send (a &ldquo;crank&rdquo;); the operator&apos;s keeper sends them on schedule, but it has no
            power over outcomes. If randomness never arrives, the cycle can be voided after a timeout, and void cycles pay nothing and return their budget.
          </p>
        </section>

        <div className="prose-doc mt-16 grid gap-x-16 lg:grid-cols-2">
          <section className="min-w-0">
            <h2 id="energy">Energy, not money</h2>
            <p>
              Each wallet receives a fixed particle-energy allowance every cycle (100 units at launch). An experiment spends <code>particles × cost</code>,
              where the cost is 1–5 depending on the particle energy you choose. Unused energy expires when the cycle ends. Nothing you spend goes to the
              protocol.
            </p>
            <p>What you do pay is outside the protocol:</p>
            <ul>
              <li>Solana network fees for your transactions (about 0.000005 SOL each).</li>
              <li>
                A refundable deposit (rent) for your position account on your first deployment of a cycle, about 0.002 SOL, returned in full when you
                claim, whether or not anything tunneled.
              </li>
              <li>If you earn $TUNNEL for the first time, the one-off rent of your token account (≈ 0.002 SOL), which you keep.</li>
            </ul>

            <h2 id="physics">The physics sets the odds</h2>
            <p>
              Each barrier is a real rectangular potential: a height V₀ and a width a. Your particle&apos;s energy is a fraction of V₀ (20–80%), so every
              success is genuine sub-barrier tunneling. The program evaluates
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
              When a cycle closes, its VRF seed is fixed from the newest slot hash, so nobody could know it while particles were being deployed. The program
              then requests randomness for that seed from <b>ORAO VRF</b>, whose authorities sign the seed and whose program verifies the signatures
              onchain. Each particle&apos;s draw is
            </p>
            <pre>
              <code>u64(sha256(&quot;TUNNEL/particle/v2&quot; ‖ randomness ‖ cycle ‖ wallet ‖ barrier ‖ level ‖ index)[0..8])</code>
            </pre>
            <p>
              and it tunnels when the draw is below <code>⌊p · 2⁶⁴⌋</code>, with no modulo bias. Anyone can recompute every outcome; the{" "}
              <Link href="/history">history</Link> pages do it in your browser.
            </p>
            <h3>Trust assumptions</h3>
            <ul>
              <li>
                ORAO VRF is not fully trustless: a colluding quorum of its authorities could learn the output early or withhold it. Withholding leads to a
                void cycle (no rewards), not to redirected rewards.
              </li>
              <li>The slot hash used for the seed is chosen by the network, not by the crank; the crank cannot grind it.</li>
              <li>On localnet, a local key plays ORAO&apos;s role through the real ORAO program; that setup is for development only.</li>
            </ul>
          </section>

          <section className="min-w-0">
            <h2 id="rewards">Rewards from a fixed reserve</h2>
            <p>
              $TUNNEL is never minted by the program. Rewards come from a reserve that was funded in advance into a program-owned vault; tokens leave it only
              through claims. Each cycle reserves a budget (initially 20,000 $TUNNEL, decaying 0.5% per day of cycles), capped by what remains in the
              reserve. If the cycle&apos;s nominal rewards exceed the budget, every payout is scaled down by the same factor. Unused budget returns to the
              reserve.
            </p>
            <p>
              Rewards are probabilistic and limited. You may receive nothing. $TUNNEL has no guaranteed value, and nothing on this site is investment advice.
            </p>

            <h2 id="abuse">Abuse mitigation (and its limits)</h2>
            <p>
              Per-wallet energy limits do not stop one person from using many wallets. TUNNEL bounds the damage instead: emissions per cycle are capped
              regardless of how many wallets play, so splitting across wallets cannot extract more than the cycle budget. Each wallet must also lock a
              small deposit and pay fees per cycle.
            </p>
            <p>
              The operator can additionally require a <b>gatekeeper co-signature</b> on every deployment. The app&apos;s co-signing service checks a signed
              wallet login and per-wallet, per-network and global rate limits before signing; it controls no funds. This is a configurable mitigation, not
              Sybil resistance.
            </p>

            <h2 id="authority">What the admin can and cannot do</h2>
            <ul>
              <li>Can: tune parameters for <i>future</i> cycles (odds are still re-derived from physics), pause new deployments, set the gatekeeper, hand over admin in two steps.</li>
              <li>Cannot: change an open cycle, set odds directly, move the reward reserve, mint tokens, or block settlement and claims (even while paused).</li>
              <li>Production should place admin and upgrade authority behind a multisig.</li>
            </ul>

            <h2 id="deployment">Deployment status</h2>
            <DeploymentStatus />
            <p>
              The program has not been independently audited. Mainnet is disabled until an audit and an explicit owner decision. Source, tests and the
              deployment checklist are in the repository.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
