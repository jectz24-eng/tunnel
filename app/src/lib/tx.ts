"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { ComputeBudgetProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { IDL } from "@tunnel/sdk";
import { useCallback, useState } from "react";
import { refreshMatching } from "./poll";

export type TxPhase = "idle" | "authorizing" | "signing" | "sending" | "confirming" | "confirmed" | "failed";

export interface TxState {
  phase: TxPhase;
  signature?: string;
  error?: string;
}

const programErrors = new Map((IDL.errors ?? []).map((e) => [e.code, e]));

/** Turns wallet / RPC / program failures into a sentence a person can act on. */
export function explainError(e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  const logs: string[] = (e as { logs?: string[] })?.logs ?? [];
  const anchor = /Error Code: (\w+)\. Error Number: (\d+)\. Error Message: ([^.]+)/.exec([msg, ...logs].join("\n"));
  if (anchor) return anchor[3];
  const custom = /custom program error: 0x([0-9a-f]+)/i.exec(msg);
  if (custom) {
    const known = programErrors.get(parseInt(custom[1], 16));
    if (known) return known.msg ?? known.name;
  }
  if (/User rejected|rejected the request|declined/i.test(msg)) return "You declined the request in your wallet. Nothing was sent.";
  if (/insufficient (lamports|funds)|Attempt to debit an account but found no record/i.test(msg))
    return "This wallet needs a little SOL for network fees and the refundable account deposit.";
  if (/Blockhash not found|block height exceeded|expired/i.test(msg)) return "The transaction expired before it was confirmed. Nothing was charged; please try again.";
  if (/429|Too Many Requests/i.test(msg)) return "Too many requests right now. Wait a moment and try again.";
  if (/fetch failed|NetworkError|Failed to fetch/i.test(msg)) return "Could not reach the Solana RPC endpoint. Check your connection.";
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}

/**
 * Sends program instructions through the connected wallet. The user always
 * approves in their wallet; this hook never signs anything itself. With
 * `cosign`, the transaction is first co-signed by the protocol gatekeeper
 * (/api/gatekeeper), which only adds its own signature after its checks.
 */
export function useSendTx() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signTransaction } = useWallet();
  const [state, setState] = useState<TxState>({ phase: "idle" });

  const send = useCallback(
    async (ixs: TransactionInstruction[], opts: { computeUnits?: number; cosign?: boolean } = {}) => {
      if (!publicKey) throw new Error("Connect a wallet first");
      try {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        let tx = new Transaction({ feePayer: publicKey, blockhash, lastValidBlockHeight });
        if (opts.computeUnits) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnits }));
        tx.add(...ixs);
        let signature: string;
        if (opts.cosign) {
          if (!signTransaction) throw new Error("This wallet cannot sign transactions for co-signing. Try another wallet.");
          setState({ phase: "authorizing" });
          const res = await fetch("/api/gatekeeper", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64") }),
          });
          const body = (await res.json().catch(() => ({}))) as { transaction?: string; error?: string };
          if (!res.ok || !body.transaction) throw new Error(body.error ?? `co-signing failed (HTTP ${res.status})`);
          tx = Transaction.from(Buffer.from(body.transaction, "base64"));
          setState({ phase: "signing" });
          const signed = await signTransaction(tx);
          setState({ phase: "sending" });
          signature = await connection.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed" });
        } else {
          setState({ phase: "signing" });
          signature = await sendTransaction(tx, connection, { preflightCommitment: "confirmed" });
        }
        setState({ phase: "confirming", signature });
        const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
        if (res.value.err) throw Object.assign(new Error(JSON.stringify(res.value.err)), { signature });
        setState({ phase: "confirmed", signature });
        refreshMatching("cycles:");
        refreshMatching("positions:");
        refreshMatching("balances:");
        refreshMatching("protocol");
        return signature;
      } catch (e) {
        setState((s) => ({ phase: "failed", signature: s.signature, error: explainError(e) }));
        return null;
      }
    },
    [connection, publicKey, sendTransaction, signTransaction],
  );

  return { state, send, reset: () => setState({ phase: "idle" }) };
}
