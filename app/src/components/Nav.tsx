"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { splitRounds, useChainClock, useDetectedCluster, useRounds } from "@/lib/chain";
import { appConfig, clusterLabel } from "@/lib/config";
import { Wordmark } from "./Logo";
import { cx } from "./ui";
import { WalletButton } from "./WalletButton";

const LINKS = [
  { href: "/mine", label: "Mine" },
  { href: "/protocol", label: "Protocol" },
  { href: "/stats", label: "Statistics" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/docs", label: "Docs" },
];

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  return (
    <header className="sticky top-0 z-40 border-b border-line-soft bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="TUNNEL home" className="shrink-0">
          <Wordmark />
        </Link>
        <nav className="hidden flex-1 items-center justify-center gap-1 md:flex" aria-label="Primary">
          {LINKS.map((l) => {
            const active = path === l.href || path.startsWith(l.href + "/");
            return (
              <Link key={l.href} href={l.href} className={cx("relative rounded-lg px-3 py-1.5 text-[13px] transition-colors", active ? "text-fg" : "text-muted hover:text-fg")}>
                {l.label}
                {active && <motion.span layoutId="nav-underline" className="absolute inset-x-3 -bottom-[13px] h-px bg-cyan" />}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <NetworkStatus />
          <WalletButton />
          <button className="flex size-8 items-center justify-center rounded-lg text-fg-2 hover:bg-panel-2 md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
            <svg width="16" height="16" viewBox="0 0 16 16">
              <path d={open ? "M3 3l10 10M13 3 3 13" : "M2 5h12M2 11h12"} stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-line-soft md:hidden" aria-label="Mobile">
            <div className="flex flex-col p-2">
              {[...LINKS, { href: "/tokenomics", label: "Tokenomics" }, { href: "/dashboard", label: "Dashboard" }].map((l) => (
                <Link key={l.href} href={l.href} className={cx("rounded-lg px-3 py-2.5 text-sm", path.startsWith(l.href) ? "bg-panel text-fg" : "text-fg-2")}>
                  {l.label}
                </Link>
              ))}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

function NetworkStatus() {
  const detected = useDetectedCluster();
  const { now } = useChainClock(1000);
  const rounds = useRounds(3);
  const { current, recent } = splitRounds(rounds.data, now);
  const shown = current ?? recent.find((r) => r.openTs <= now) ?? null;
  const mismatch = detected.data && detected.data !== appConfig.cluster && !(appConfig.cluster === "localnet" && detected.data === "localnet");

  return (
    <div className="hidden items-center gap-2 lg:flex">
      <span
        className={cx(
          "flex h-8 items-center gap-2 rounded-[10px] border px-2.5 font-mono text-[11px] tracking-wide",
          mismatch ? "border-red/40 text-red" : "border-line text-fg-2",
        )}
        title={mismatch ? `RPC reports ${detected.data}, app is configured for ${appConfig.cluster}` : undefined}
      >
        <span className={cx("size-1.5 rounded-full", appConfig.cluster === "mainnet-beta" ? "bg-green" : "bg-amber")} />
        {clusterLabel[appConfig.cluster]}
      </span>
      <span className="flex h-8 items-center rounded-[10px] border border-line px-2.5 font-mono text-[11px] tracking-wide text-fg-2">
        {shown ? <>Round {shown.id.toLocaleString()}</> : rounds.protocol.data === null ? "Not deployed" : "Round —"}
      </span>
    </div>
  );
}
