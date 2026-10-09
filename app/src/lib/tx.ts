"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { ComputeBudgetProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { IDL } from "@tunnel/sdk";
import { useCallback, useState } from "react";
import { refreshMatching } from "./poll";

export type TxPhase = "idle" | "signing" | "sending" | "confirming" | "confirmed" | "failed";

export interface TxState {
  phase: TxPhase;
  signature?: string;
  error?: string;
}

const programErrors = new Map((IDL.errors ?? []).map((e) => [e.code, e]));

/** Turns wallet / RPC / program failures into a sentence a person can act on. */
export function explainError(e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  const logs: string[] = (e as any)?.logs ?? [];
  const anchor = /Error Code: (\w+)\. Error Number: (\d+)\. Error Message: ([^.]+)/.exec([msg, ...logs].join("\n"));
  if (anchor) return anchor[3];
  const custom = /custom program error: 0x([0-9a-f]+)/i.exec(msg);
  if (custom) {
    const code = parseInt(custom[1], 16);
    const known = programErrors.get(code);
    if (known) return known.msg ?? known.name;
  }
  if (/User rejected|rejected the request|declined/i.test(msg)) return "You declined the request in your wallet. Nothing was sent.";
  if (/insufficient (lamports|funds)|Attempt to debit an account but found no record/i.test(msg))
    return "Not enough SOL in this wallet to cover the deposit and network fees.";
  if (/Blockhash not found|block height exceeded|expired/i.test(msg))
    return "The transaction expired before it was confirmed. Nothing was charged; please try again.";
  if (/429|Too Many Requests/i.test(msg)) return "The RPC endpoint is rate limiting requests. Wait a moment and try again.";
  if (/fetch failed|NetworkError|Failed to fetch/i.test(msg)) return "Could not reach the Solana RPC endpoint. Check your connection.";
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}

/**
 * Sends program instructions through the connected wallet. The user always
 * approves in their wallet; this hook never signs anything itself.
 */
export function useSendTx() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [state, setState] = useState<TxState>({ phase: "idle" });

  const send = useCallback(
    async (ixs: TransactionInstruction[], opts: { computeUnits?: number } = {}) => {
      if (!publicKey) throw new Error("Connect a wallet first");
      setState({ phase: "signing" });
      try {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        const tx = new Transaction({ feePayer: publicKey, blockhash, lastValidBlockHeight });
        if (opts.computeUnits) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnits }));
        tx.add(...ixs);
        const signature = await sendTransaction(tx, connection, { preflightCommitment: "confirmed" });
        setState({ phase: "confirming", signature });
        const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
        if (res.value.err) throw Object.assign(new Error(JSON.stringify(res.value.err)), { signature });
        setState({ phase: "confirmed", signature });
        refreshMatching("rounds:");
        refreshMatching("positions:");
        refreshMatching("balances:");
        refreshMatching("protocol");
        return signature;
      } catch (e) {
        setState((s) => ({ phase: "failed", signature: s.signature, error: explainError(e) }));
        return null;
      }
    },
    [connection, publicKey, sendTransaction],
  );

  return { state, send, reset: () => setState({ phase: "idle" }) };
}
