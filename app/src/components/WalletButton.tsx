"use client";

import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { formatSol, formatTunnel, shortKey } from "@tunnel/sdk";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useBalances } from "@/lib/chain";
import { appConfig, clusterLabel, explorerAddress } from "@/lib/config";
import { Button, cx } from "./ui";
import { useWalletAuth } from "./WalletAuth";

const INSTALL = [
  { name: "Phantom", url: "https://phantom.com/download" },
  { name: "Solflare", url: "https://solflare.com/download" },
];

export function WalletButton({ className }: { className?: string }) {
  const { publicKey, connected, connecting, disconnect } = useWallet();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const balances = useBalances(publicKey ?? null);
  const auth = useWalletAuth();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menuOpen]);

  if (!connected || !publicKey) {
    return (
      <>
        <Button variant="primary" size="sm" aria-label="Connect Wallet" className={cx("whitespace-nowrap", className)} onClick={() => setPickerOpen(true)} disabled={connecting}>
          {connecting ? (
            "Connecting…"
          ) : (
            <>
              <span className="sm:hidden">Connect</span>
              <span className="hidden sm:inline">Connect Wallet</span>
            </>
          )}
        </Button>
        <WalletPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
      </>
    );
  }

  const key = publicKey.toBase58();
  return (
    <div className={cx("relative", className)} ref={menuRef}>
      <button
        onClick={() => setMenuOpen((o) => !o)}
        className="flex h-8 items-center gap-2 whitespace-nowrap rounded-[10px] border border-line bg-panel-2 px-3 font-mono text-[12px] text-fg hover:border-muted/50"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <span className="size-1.5 rounded-full bg-cyan shadow-[0_0_8px_#00D9FF]" />
        {shortKey(key)}
        {balances.data && <span className="hidden text-muted sm:inline">{formatSol(balances.data.lamports, 3)} SOL</span>}
      </button>
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
            className="panel absolute right-0 top-10 z-50 w-72 p-1.5 shadow-2xl shadow-black/60"
          >
            <div className="px-3 py-2.5">
              <div className="label">Connected · {clusterLabel[appConfig.cluster]}</div>
              <div className="mt-1.5 break-all font-mono text-[11.5px] leading-relaxed text-fg-2">{key}</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <div className="label">SOL</div>
                  <div className="mt-1 font-mono text-sm tabular">{balances.data ? formatSol(balances.data.lamports) : "—"}</div>
                </div>
                <div>
                  <div className="label">$TUNNEL</div>
                  <div className="mt-1 font-mono text-sm tabular">{balances.data?.tunnel != null ? formatTunnel(balances.data.tunnel) : "—"}</div>
                </div>
              </div>
              {appConfig.cluster === "devnet" && balances.data && balances.data.lamports < 20_000_000n && (
                <a href="https://faucet.solana.com" target="_blank" rel="noreferrer" className="mt-3 block text-xs text-cyan hover:underline">
                  Low devnet balance — get free devnet SOL
                </a>
              )}
            </div>
            <div className="my-1 h-px bg-line-soft" />
            <MenuItem onClick={() => void auth.signIn()} disabled={auth.status === "verified" || auth.status === "signing"}>
              {auth.status === "verified" ? "Wallet ownership verified" : auth.status === "signing" ? "Waiting for signature…" : "Verify wallet ownership"}
            </MenuItem>
            <Link href={`/profile/${key}`} onClick={() => setMenuOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-fg-2 hover:bg-panel-2 hover:text-fg">
              My experiments
            </Link>
            <Link href="/accelerator#claims" onClick={() => setMenuOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-fg-2 hover:bg-panel-2 hover:text-fg">
              Claim rewards
            </Link>
            <a href={explorerAddress(key)} target="_blank" rel="noreferrer" className="block rounded-lg px-3 py-2 text-sm text-fg-2 hover:bg-panel-2 hover:text-fg">
              View on Explorer
            </a>
            <MenuItem onClick={() => navigator.clipboard?.writeText(key)}>Copy address</MenuItem>
            <MenuItem
              onClick={() => {
                setMenuOpen(false);
                void auth.signOut();
                void disconnect();
              }}
            >
              Disconnect
            </MenuItem>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button role="menuitem" onClick={onClick} disabled={disabled} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-fg-2 hover:bg-panel-2 hover:text-fg disabled:text-muted disabled:hover:bg-transparent">
      {children}
    </button>
  );
}

export function WalletPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { wallets, select, connect, wallet } = useWallet();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const available = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // After `select`, the adapter changes on the next render; connect then.
  useEffect(() => {
    if (!pending || wallet?.adapter.name !== pending) return;
    connect()
      .then(onClose)
      .catch((e) => setError(/reject/i.test(String(e)) ? "Connection request was declined." : String(e?.message ?? e)))
      .finally(() => setPending(null));
  }, [pending, wallet, connect, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Connect a Solana wallet"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="panel w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Connect a wallet</h2>
              <button onClick={onClose} className="text-muted hover:text-fg" aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.4" /></svg>
              </button>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              TUNNEL never asks for your seed phrase or private key. Every transaction is approved in your wallet.
            </p>
            <div className="mt-4 space-y-2">
              {available.map((w) => (
                <button
                  key={w.adapter.name}
                  onClick={() => {
                    setError(null);
                    setPending(w.adapter.name);
                    select(w.adapter.name);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border border-line bg-bg-2 px-3.5 py-3 text-left text-sm hover:border-muted/50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.adapter.icon} alt="" width={24} height={24} className="rounded-md" />
                  <span className="flex-1">{w.adapter.name}</span>
                  <span className="font-mono text-[10.5px] tracking-wider text-muted">{pending === w.adapter.name ? "CONNECTING" : "DETECTED"}</span>
                </button>
              ))}
              {available.length === 0 && (
                <div className="rounded-xl border border-line bg-bg-2 p-4 text-sm text-fg-2">
                  No Solana wallet detected in this browser.
                  <div className="mt-3 flex gap-2">
                    {INSTALL.map((i) => (
                      <a key={i.name} href={i.url} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-muted/50">
                        Install {i.name}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {error && <p className="mt-3 text-xs text-red">{error}</p>}
            {appConfig.cluster !== "mainnet-beta" && (
              <p className="mt-4 border-t border-line-soft pt-3 text-[11.5px] leading-relaxed text-muted">
                This deployment runs on Solana <span className="text-fg-2">{clusterLabel[appConfig.cluster]}</span>. Devnet SOL has no monetary value.
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
