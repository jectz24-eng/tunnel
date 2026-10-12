"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { splitCycles, useChainClock, useCycles, useDetectedCluster } from "@/lib/chain";
import { appConfig, clusterLabel } from "@/lib/config";
import { formatCountdown } from "@/lib/cycle";
import { Wordmark } from "./Logo";
import { SoundToggle } from "./SoundToggle";
import { ButtonLink, cx } from "./ui";
import { WalletButton } from "./WalletButton";

export const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/accelerator", label: "Accelerator" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/laboratory", label: "Laboratory" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/tokenomics", label: "Tokenomics" },
  { href: "/history", label: "History" },
];

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header className={cx("sticky top-0 z-40 border-b transition-colors duration-300", scrolled || open ? "border-line-soft bg-bg/80 backdrop-blur-xl" : "border-transparent bg-transparent")}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-panel focus:px-3 focus:py-2 focus:text-sm">
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="TUNNEL home" className="shrink-0">
          <Wordmark />
        </Link>
        <nav className="hidden flex-1 items-center justify-center gap-0.5 xl:flex" aria-label="Primary">
          {NAV_LINKS.map((l) => {
            const active = isActive(path, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cx("relative whitespace-nowrap rounded-lg px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] transition-colors", active ? "text-fg" : "text-muted hover:text-fg")}
              >
                {l.label}
                {active && <motion.span layoutId="nav-underline" className="absolute inset-x-2.5 -bottom-[17px] h-px bg-cyan shadow-[0_0_8px_#00D9FF]" />}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 xl:ml-0">
          <CycleChip />
          <SoundToggle className="hidden sm:flex" />
          <WalletButton />
          <span className="hidden md:inline-flex">
            <ButtonLink href="/accelerator" variant="energy" size="sm" className="whitespace-nowrap px-3.5 font-mono text-[11px] uppercase tracking-[0.12em]">
              Start mining
            </ButtonLink>
          </span>
          <button className="flex size-9 items-center justify-center rounded-lg text-fg-2 hover:bg-panel-2 xl:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d={open ? "M3 3l10 10M13 3 3 13" : "M2 5h12M2 11h12"} stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-line-soft xl:hidden" aria-label="Mobile">
            <div className="grid gap-1 p-3 sm:grid-cols-2">
              {NAV_LINKS.map((l, i) => (
                <Link key={l.href} href={l.href} className={cx("flex items-center gap-3 rounded-xl px-4 py-3.5 text-[15px]", isActive(path, l.href) ? "bg-panel text-fg" : "text-fg-2 hover:bg-panel/60")}>
                  <span className="font-mono text-[10px] text-faint">0{i + 1}</span>
                  {l.label}
                </Link>
              ))}
              <div className="mt-2 flex items-center gap-2 px-1 sm:col-span-2">
                <ButtonLink href="/accelerator" variant="energy" size="md" className="flex-1">
                  Start mining
                </ButtonLink>
                <SoundToggle className="size-10" />
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

function CycleChip() {
  const detected = useDetectedCluster();
  const { now } = useChainClock(1000);
  const cycles = useCycles();
  const { current } = splitCycles(cycles.data, now);
  const mismatch = detected.data && detected.data !== appConfig.cluster && !(appConfig.cluster === "localnet" && detected.data === "localnet");
  return (
    <Link
      href="/accelerator"
      className={cx(
        "hidden h-8 items-center gap-2 whitespace-nowrap rounded-[10px] border px-2.5 font-mono text-[11px] tracking-wide 2xl:flex",
        mismatch ? "border-red/40 text-red" : "border-line text-fg-2 hover:border-muted/50",
      )}
      title={mismatch ? `RPC reports ${detected.data}, app is configured for ${appConfig.cluster}` : "Current mining cycle"}
    >
      <span className={cx("size-1.5 rounded-full", appConfig.cluster === "mainnet-beta" ? "bg-cyan" : "bg-amber")} />
      {clusterLabel[appConfig.cluster]}
      <span className="text-faint">/</span>
      {current ? (
        <>
          <span>C{current.id.toString()}</span>
          <span className="tabular text-cyan">{formatCountdown(current.closeTs - now)}</span>
        </>
      ) : cycles.protocol.data === null ? (
        "not deployed"
      ) : (
        "between cycles"
      )}
    </Link>
  );
}
