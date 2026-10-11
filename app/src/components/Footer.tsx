import Link from "next/link";
import { appConfig, clusterLabel, explorerAddress } from "@/lib/config";
import { LogoMark } from "./Logo";

export function Footer() {
  const program = appConfig.programId.toBase58();
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
            Quantum Tunneling Protocol. Tunneling probabilities come from a simplified one-dimensional barrier model; individual outcomes come from ORAO
            verifiable randomness. This is not quantum computing and not proof-of-work mining. Mining is free of protocol charges; rewards are limited and
            probabilistic, and $TUNNEL has no guaranteed value.
          </p>
        </div>
        <FooterCol title="Protocol" links={[["Accelerator", "/accelerator"], ["How it works", "/how-it-works"], ["Laboratory", "/laboratory"], ["Tokenomics", "/tokenomics"]]} />
        <FooterCol title="Records" links={[["Experiment history", "/history"], ["Leaderboard", "/leaderboard"], ["Risks", "/tokenomics#risks"], ["Randomness", "/how-it-works#randomness"]]} />
        <div>
          <div className="label">Network</div>
          <div className="mt-3 space-y-2 text-xs text-muted">
            <div>
              Cluster · <span className="text-fg-2">{clusterLabel[appConfig.cluster]}</span>
            </div>
            <div className="break-all">
              Program ·{" "}
              <a href={explorerAddress(program)} target="_blank" rel="noreferrer" className="font-mono text-fg-2 hover:text-cyan">
                {program.slice(0, 6)}…{program.slice(-6)}
              </a>
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
