import Link from "next/link";
import { appConfig, clusterLabel } from "@/lib/config";
import { LogoMark } from "./Logo";

export function Footer() {
  return (
    <footer className="relative mt-32 border-t border-line-soft">
      <div className="hairline-x absolute inset-x-0 top-0 opacity-60" />
      <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <span className="text-[13px] font-semibold tracking-[0.34em]">TUNNEL</span>
          </div>
          <p className="mt-5 max-w-sm text-xs leading-relaxed text-muted">
            Fire particles at quantum barriers and win $TUNNEL every time one tunnels through. Every result is provably fair and verifiable. 18+ only.
            Play responsibly and only with what you can afford to lose. Not available where prohibited.
          </p>
        </div>
        <FooterCol title="Protocol" links={[["Accelerator", "/accelerator"], ["How it works", "/how-it-works"], ["Laboratory", "/laboratory"], ["Tokenomics", "/tokenomics"]]} />
        <FooterCol title="Records" links={[["Shot history", "/history"], ["Leaderboard", "/leaderboard"], ["Risks", "/tokenomics#risks"], ["Provably fair", "/how-it-works#fair"]]} />
        <div>
          <div className="label">Network</div>
          <div className="mt-3 space-y-2 text-xs text-muted">
            <div>
              Cluster · <span className="text-fg-2">{clusterLabel[appConfig.cluster]}</span>
            </div>
            <div>
              Rewards · <span className="text-fg-2">$TUNNEL (SPL token)</span>
            </div>
            <div>
              Audit · <span className="text-amber">Not audited</span>
            </div>
          </div>
        </div>
      </div>
      <div className="border-t border-line-soft">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 px-4 py-4 font-mono text-[10.5px] tracking-[0.14em] text-faint sm:px-6">
          <span>TUNNEL / QUANTUM EXPERIMENT 001</span>
          <span>MINE THROUGH THE IMPOSSIBLE.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="label">{title}</div>
      <ul className="mt-3 space-y-2">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="text-xs text-muted hover:text-fg">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
