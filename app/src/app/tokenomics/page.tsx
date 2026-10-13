import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { TokenomicsView } from "./TokenomicsView";

export const metadata: Metadata = {
  title: "Tokenomics",
  description: "$TUNNEL: the token that powers the accelerator. Supply, the vault, deposits and withdrawals, addresses, and what to know before you play.",
};

const SECTIONS: [string, string, string][] = [
  ["the-token", "The token", "$TUNNEL is an SPL token on Solana with 6 decimals. It is the only currency in the accelerator: you fire particles with it and every tunnel pays out in it. Revoking the mint authority fixes the supply forever; the panel above shows whether that has happened."],
  ["the-vault", "The vault", "Deposits go to the TUNNEL vault wallet, whose balance anyone can check on Solana. Your balance is credited the moment the transfer finalizes, and every withdrawal is a real $TUNNEL transfer back to your wallet."],
  ["the-shots", "The shots", "Each particle is an independent shot at the barrier you choose. Low, medium and high barriers have fixed win chances and multipliers, shown before you fire. Bet size and particle count are up to you within the table limits."],
  ["the-fairness", "Provably fair", "Every shot is decided by HMAC-SHA256 of a server seed (its hash is shown before you play), your own client seed, and a counter. Rotate your seed at any time to reveal the old one and verify every past shot in your browser."],
  ["the-practice", "Practice", "The Laboratory runs the exact same barriers, multipliers and draw function with free practice credits, so you can test strategies before using real $TUNNEL."],
  ["the-limits", "Table limits", "Minimum and maximum bets keep the accelerator healthy for everyone."],
];

const RISKS = [
  "Every shot is a game of chance. You can lose your entire bet, and past results never predict the next particle.",
  "Only play with $TUNNEL you can afford to lose. Set yourself limits and take breaks.",
  "The accelerator is for adults (18+) only, and only where games of chance with digital assets are legal.",
  "$TUNNEL has no guaranteed price, liquidity or value. Nothing here is investment advice.",
  "Balances are held by the TUNNEL vault, operated by the TUNNEL team. Withdraw whenever you like; you rely on TUNNEL to process it.",
  "TUNNEL has not been independently audited. Software can contain bugs.",
];

export default function TokenomicsPage() {
  return (
    <>
      <PageHeader eyebrow="Tokenomics" title={<>One token. One accelerator.</>}>
        $TUNNEL powers every shot. Live figures on this page come straight from Solana; allocations that have not been finalized are marked as placeholders.
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
          <h2 className="font-mono text-[12px] uppercase tracking-[0.18em] text-amber">Play responsibly</h2>
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
