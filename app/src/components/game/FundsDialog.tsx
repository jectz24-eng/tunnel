"use client";

import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { TUNNEL_DECIMALS, encodeBase58, formatTunnel, parseTunnel, tunnelToPlain, withdrawalMessage } from "@tunnel/sdk";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useBalances } from "@/lib/chain";
import { explorerTx } from "@/lib/config";
import { refreshMatching } from "@/lib/poll";
import { explainError, newNonce } from "@/lib/tx";
import { Arrow, Button } from "../ui";

type Phase = { k: "idle" } | { k: "busy"; label: string } | { k: "done"; text: string; sig?: string } | { k: "error"; text: string };

/**
 * Deposit: an SPL transfer of $TUNNEL from the player's wallet to the house
 * account, approved in the wallet. Credited once finalized (~15 s).
 * Withdraw: a free signed message; TUNNEL sends the $TUNNEL and pays the fee.
 */
export function FundsDialog({
  open,
  kind,
  onClose,
  balance,
  depositAddress,
  tunnelMint,
}: {
  open: boolean;
  kind: "deposit" | "withdraw";
  onClose: () => void;
  balance: bigint | null;
  depositAddress: string | null;
  tunnelMint: string | null;
}) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signMessage } = useWallet();
  const wallet = useBalances(publicKey ?? null);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  useEffect(() => {
    if (open) {
      setText("");
      setPhase({ k: "idle" });
    }
  }, [open, kind]);

  const amount = parseTunnel(text);
  const max = kind === "deposit" ? (wallet.data?.tunnel ?? null) : balance;
  const valid = amount != null && amount > 0n && (max == null || amount <= max) && (kind === "deposit" || amount >= 1_000_000n);
  const busy = phase.k === "busy";

  const deposit = async () => {
    if (!publicKey || !depositAddress || !tunnelMint || !amount) return;
    try {
      setPhase({ k: "busy", label: "Approve in your wallet…" });
      const mint = new PublicKey(tunnelMint);
      const house = new PublicKey(depositAddress);
      const program = (await connection.getAccountInfo(mint))?.owner;
      if (!program) throw new Error("Token not found on this network.");
      const from = getAssociatedTokenAddressSync(mint, publicKey, false, program);
      const to = getAssociatedTokenAddressSync(mint, house, false, program);
      const tx = new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(publicKey, to, house, mint, program),
        createTransferCheckedInstruction(from, mint, to, publicKey, amount, TUNNEL_DECIMALS, [], program),
      );
      const sig = await sendTransaction(tx, connection, { preflightCommitment: "confirmed" });
      setPhase({ k: "busy", label: "Confirming on Solana…" });
      const bh = await connection.getLatestBlockhash("confirmed");
      const res = await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      if (res.value.err) throw new Error("The transfer failed on-chain. Nothing was deposited.");
      setPhase({ k: "done", text: `${formatTunnel(amount)} $TUNNEL sent. It lands in your balance as soon as Solana finalizes it (about 15 seconds).`, sig });
      for (const ms of [5_000, 12_000, 20_000, 30_000]) setTimeout(() => refreshMatching("casino:"), ms);
      refreshMatching("balances:");
    } catch (e) {
      setPhase({ k: "error", text: explainError(e) });
    }
  };

  const withdraw = async () => {
    if (!publicKey || !signMessage || !amount) return;
    try {
      setPhase({ k: "busy", label: "Sign the withdrawal in your wallet…" });
      const message = withdrawalMessage({ wallet: publicKey.toBase58(), amount: tunnelToPlain(amount), nonce: newNonce(), issuedAt: new Date().toISOString() });
      const signature = encodeBase58(await signMessage(new TextEncoder().encode(message)));
      setPhase({ k: "busy", label: "Requesting withdrawal…" });
      const res = await fetch("/api/casino/withdraw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Withdrawal failed (HTTP ${res.status})`);
      setPhase({ k: "done", text: `${formatTunnel(amount)} $TUNNEL is on its way to your wallet. No fee: TUNNEL covers the network cost.` });
      refreshMatching("casino:");
    } catch (e) {
      setPhase({ k: "error", text: explainError(e) });
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !busy && onClose()}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="funds-title"
            initial={{ y: 16, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="panel brackets w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-line-soft px-6 py-5">
              <div className="eyebrow">{kind === "deposit" ? "Fuel the accelerator" : "Cash out"}</div>
              <h2 id="funds-title" className="mt-2 text-xl font-semibold tracking-tight">
                {kind === "deposit" ? "Deposit $TUNNEL" : "Withdraw $TUNNEL"}
              </h2>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="funds-amount" className="label">
                    Amount
                  </label>
                  <button className="font-mono text-[11px] text-cyan hover:underline disabled:opacity-40" disabled={max == null || busy} onClick={() => max != null && setText(tunnelToPlain(max))}>
                    {kind === "deposit" ? "wallet" : "balance"}: {max != null ? formatTunnel(max) : "—"}
                  </button>
                </div>
                <div className="relative mt-2">
                  <input
                    id="funds-amount"
                    inputMode="decimal"
                    autoFocus
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    disabled={busy}
                    placeholder="0.00"
                    className="h-12 w-full rounded-lg border border-line bg-bg-2 pl-4 pr-24 font-mono text-lg tabular"
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs text-muted">$TUNNEL</span>
                </div>
              </div>
              <p className="text-[12.5px] leading-relaxed text-fg-2">
                {kind === "deposit"
                  ? "Your wallet asks you to approve one $TUNNEL transfer to the TUNNEL vault. Your balance updates automatically once Solana finalizes it."
                  : "Sign a free message (no transaction). TUNNEL sends the $TUNNEL straight to this wallet and pays the network fee. Minimum 1 $TUNNEL."}
              </p>
              {phase.k === "done" && (
                <div className="rounded-lg border border-cyan/25 bg-cyan/[0.06] px-3 py-2.5 text-[12.5px] text-cyan">
                  {phase.text}
                  {phase.sig && (
                    <a className="ml-1 underline" href={explorerTx(phase.sig)} target="_blank" rel="noreferrer">
                      View transaction
                    </a>
                  )}
                </div>
              )}
              {phase.k === "error" && <div className="rounded-lg border border-red/25 bg-red/[0.06] px-3 py-2.5 text-[12.5px] text-red">{phase.text}</div>}
            </div>
            <div className="flex items-center gap-2 border-t border-line-soft px-6 py-4">
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                {phase.k === "done" ? "Close" : "Cancel"}
              </Button>
              {phase.k !== "done" && (
                <Button variant="energy" className="ml-auto font-mono uppercase tracking-[0.1em]" disabled={!valid || busy} onClick={kind === "deposit" ? deposit : withdraw}>
                  {busy ? (phase as { label: string }).label : <>{kind === "deposit" ? "Deposit" : "Withdraw"} <Arrow /></>}
                </Button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
