import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { TokenomicsView } from "./TokenomicsView";

export const metadata: Metadata = {
  title: "Tokenomics",
  description: "$TUNNEL supply, the emissions reserve, cycle budgets, claimed rewards, addresses, and the risks of a probabilistic protocol.",
};

const SECTIONS: [string, string, string][] = [
  ["the-token", "The token", "$TUNNEL is an SPL token with 6 decimals. TUNNEL never mints it: rewards are paid only from a reserve transferred into the TUNNEL reward wallet in advance. Revoking the mint authority fixes the supply permanently; the page above shows whether that has happened."],
  ["the-emissions", "The emissions", "Every cycle reserves a budget from the reserve: a scheduled amount that decays slowly over time, capped by what is left. At settlement the cycle pays what its particles earned, up to the budget, scaling everyone down equally if needed. Anything unused returns to the reserve."],
  ["the-energy", "The energy system", "Participation costs energy, not money. Each wallet gets a fixed allowance per cycle that expires unused. Energy is not a token, cannot be bought or transferred, and has no value outside a cycle."],
  ["the-physics", "The physics", "Each barrier's tunneling probability comes from the rectangular-barrier transmission formula evaluated by the program. Rewards are calibrated to those probabilities so the expected value per unit of energy is the same across energy levels."],
  ["the-randomness", "The randomness", "Each cycle's outcomes come from a server seed committed before anyone deploys, combined with a Solana blockhash that does not exist until deployments close. The seed is revealed afterwards, so anyone can recompute every particle."],
  ["the-treasury", "The treasury", "TUNNEL charges no fees and keeps no treasury. The only protocol-controlled funds are the $TUNNEL and a little SOL in the reward wallet, which pays claims and their network fees."],
];

const RISKS = [
  "Rewards are probabilistic. You may deploy particles for many cycles and receive nothing.",
  "Rewards are limited: per-cycle budgets cap total payouts, and heavy participation scales individual rewards down.",
  "$TUNNEL has no guaranteed price, liquidity or value. Nothing here is investment advice or a promise of returns.",
  "The program has not been independently audited. Smart contracts can contain bugs that lead to loss of rewards.",
  "TUNNEL runs on its own server, not a smart contract. You rely on it to stay online, settle every cycle and pay claims from its reward wallet. Outages can delay or void cycles.",
  "Parameters for future cycles can be changed by the admin (never for an open cycle). Production should use a multisig.",
  "Many wallets controlled by one person can dilute others within a cycle's budget; rate limiting mitigates but does not prevent this.",
  "Local laws may restrict participation in token distributions. You are responsible for compliance where you live.",
];

export default function TokenomicsPage() {
  return (
    <>
      <PageHeader eyebrow="Tokenomics & protocol" title={<>A fixed reserve. A transparent flow.</>}>
        Every live figure on this page is read from chain. Allocations that have not been configured are labelled as placeholders.
      </PageHeader>
      <TokenomicsView />
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
        <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-2 lg:grid-cols-3">
          {SECTIONS.map(([id, title, body]) => (
            <section key={id} id={id} className="scroll-mt-24 bg-panel p-7">
              <h2 className="font-mono text-[12px] uppercase tracking-[0.18em] text-cyan">{title}</h2>
              <p className="mt-4 text-sm leading-relaxed text-fg-2">{body}</p>
            </section>
          ))}
        </div>
        <section id="risks" className="mt-10 scroll-mt-24 rounded-2xl border border-amber/25 bg-amber/[0.03] p-7">
          <h2 className="font-mono text-[12px] uppercase tracking-[0.18em] text-amber">The risks</h2>
          <ul className="mt-5 grid gap-3 md:grid-cols-2">
            {RISKS.map((r) => (
              <li key={r} className="flex gap-3 text-sm leading-relaxed text-fg-2">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-amber" />
                {r}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
