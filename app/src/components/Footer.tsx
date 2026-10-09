import Link from "next/link";
import { appConfig, clusterLabel, explorerAddress } from "@/lib/config";
import { LogoMark } from "./Logo";

export function Footer() {
  const program = appConfig.programId.toBase58();
  return (
    <footer className="mt-24 border-t border-line-soft">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <span className="text-[13px] font-semibold tracking-[0.32em]">TUNNEL</span>
          </div>
          <p className="mt-4 max-w-xs text-xs leading-relaxed text-muted">
            A quantum-inspired stochastic mining protocol on Solana. Outcomes are derived from verifiable randomness, not from quantum hardware.
            Committing SOL can result in partial or total loss.
          </p>
        </div>
        <FooterCol title="Protocol" links={[["Mine", "/mine"], ["How it works", "/protocol"], ["Tokenomics", "/tokenomics"], ["Statistics", "/stats"]]} />
        <FooterCol title="Resources" links={[["Documentation", "/docs"], ["Risk disclosures", "/docs#risks"], ["Randomness verification", "/docs#randomness"], ["Audit status", "/docs#audit"]]} />
        <div>
          <div className="label">Network</div>
          <div className="mt-3 space-y-2 text-xs text-muted">
            <div>Cluster · <span className="text-fg-2">{clusterLabel[appConfig.cluster]}</span></div>
            <div className="break-all">
              Program ·{" "}
              <a href={explorerAddress(program)} target="_blank" rel="noreferrer" className="font-mono text-fg-2 hover:text-cyan">
                {program.slice(0, 6)}…{program.slice(-6)}
              </a>
            </div>
            <div>Audit · <span className="text-amber">Not yet audited</span></div>
          </div>
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
