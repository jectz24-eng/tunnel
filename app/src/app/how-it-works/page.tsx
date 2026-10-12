import { DEFAULT_PARAMS, MAX_PARTICLES_PER_BET, VOLATILITY, formatChance, formatMilli, formatMultiplier } from "@tunnel/sdk";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { DeploymentStatus } from "./DeploymentStatus";

export const metadata: Metadata = {
  title: "How it works",
  description: "How the TUNNEL accelerator works: barriers and volatility, particle energy and bet size, instant provably fair results, deposits and withdrawals.",
};

const FLOW = [
  ["Connect", "Link a Solana wallet and sign in with a free message. No transaction, no fees.", "#00D9FF"],
  ["Deposit", "Send $TUNNEL to the vault. It lands in your balance as soon as Solana finalizes it.", "#00D9FF"],
  ["Pick a barrier", "Low, medium or high. Your volatility: how often particles break through and how much each one pays.", "#2864FF"],
  ["Charge", "Set the energy behind each particle (your bet size) and how many particles to fire at once.", "#885BFF"],
  ["Fire", "Every particle hits the barrier and is decided instantly. Watch each one tunnel through or bounce back.", "#EAFBFF"],
  ["Cash out", "Withdraw any time with a free signature. TUNNEL sends the $TUNNEL and covers the network fee.", "#EAFBFF"],
] as const;

export default function HowItWorksPage() {
  return (
    <>
      <PageHeader eyebrow="How it works" title={<>From wallet to breakthrough.</>}>
        The accelerator turns quantum tunneling into a game of nerve: choose how hard the wall is, decide how much energy to put behind each particle,
        and fire. Every result is instant and provably fair.
      </PageHeader>

      <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6">
        <section aria-labelledby="flow">
          <h2 id="flow" className="text-2xl font-semibold tracking-tight">
            One shot, start to finish
          </h2>
          <ol className="relative mt-8 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-6">
            {FLOW.map(([title, body, color], i) => (
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
        </section>

        <div className="prose-doc mt-16 grid gap-x-16 lg:grid-cols-2">
          <section className="min-w-0">
            <h2 id="barriers">The barriers: your volatility</h2>
            <p>Each barrier is a different wall. The taller and wider it is, the harder it is to tunnel through, and the more a particle pays when it does.</p>
            <table>
              <thead>
                <tr>
                  <th>Barrier</th>
                  <th>Win chance</th>
                  <th>Pays</th>
                  <th>V₀ · a</th>
                </tr>
              </thead>
              <tbody>
                {VOLATILITY.map((v, i) => (
                  <tr key={v.key}>
                    <td style={{ color: v.color }}>{v.short}</td>
                    <td>{formatChance(v.ppb)}</td>
                    <td>{formatMultiplier(v.multiplierBps)}</td>
                    <td>
                      {formatMilli(DEFAULT_PARAMS.barriers[i].heightMilli, 1)} · {formatMilli(DEFAULT_PARAMS.barriers[i].widthMilli, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              A particle that tunnels pays its energy times the multiplier. A particle that reflects is lost. Payouts land in your balance the moment the
              shot resolves.
            </p>

            <h2 id="energy">Particle energy and particles</h2>
            <p>
              <b>Particle energy</b> is your bet per particle: pick a preset from E1 to E5 or type any amount within the table limits. <b>Particles</b> is
              how many independent shots you fire at once, from 1 to {MAX_PARTICLES_PER_BET}. Your total bet is energy × particles, and the maximum win
              is every particle tunneling.
            </p>
            <p>
              Want to find your style first? The <Link href="/laboratory">Laboratory</Link> runs the same barriers, payouts and draws with free practice
              credits.
            </p>

            <h2 id="fair">Provably fair</h2>
            <p>Before you fire, the accelerator shows you the hash of its secret server seed. Every particle is then decided by</p>
            <pre>
              <code>HMAC-SHA256(server seed, &quot;TUNNEL/bet/v1:client seed:nonce:particle&quot;)</code>
            </pre>
            <p>
              The first 8 bytes are compared with the barrier&apos;s win chance. You choose the client seed, and the nonce counts up with every shot, so
              the server cannot pick outcomes and cannot change its seed after you have seen the hash. Rotate your seed whenever you want: the old server
              seed is revealed and every shot made with it can be checked from its page in <Link href="/history">History</Link>, right in your browser.
            </p>
          </section>

          <section className="min-w-0">
            <h2 id="vault">Deposits and withdrawals</h2>
            <p>
              Deposits are a normal $TUNNEL transfer to the TUNNEL vault, approved in your wallet. Your balance updates as soon as Solana finalizes the
              transfer, usually within about 15 seconds.
            </p>
            <p>
              Withdrawals are a free signed message. TUNNEL sends the $TUNNEL straight to your wallet and pays the network fee. Every withdrawal is a real
              Solana transaction you can look up on any explorer.
            </p>

            <h2 id="physics">Why “tunneling”?</h2>
            <p>
              In quantum mechanics, a particle can pass through a barrier it doesn&apos;t have the energy to climb, and the chance shrinks fast as the
              barrier gets taller and wider. The three walls in the accelerator are modelled on exactly that. Explore the real equation in the{" "}
              <Link href="/laboratory">Laboratory</Link>.
            </p>

            <h2 id="responsible">Play responsibly</h2>
            <ul>
              <li>The accelerator is for adults (18+) only, where games of chance with digital assets are legal.</li>
              <li>Every shot can lose. Only play with what you can afford to lose, set limits and take breaks.</li>
              <li>$TUNNEL has no guaranteed value. Nothing on this site is investment advice.</li>
            </ul>

            <h2 id="deployment">Status</h2>
            <DeploymentStatus />
          </section>
        </div>
      </div>
    </>
  );
}
