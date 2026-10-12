"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { encodeBase58 } from "@tunnel/sdk";
import { useCallback, useState } from "react";
import { refreshMatching } from "./poll";

export type TxPhase = "idle" | "signing" | "sending" | "confirmed" | "failed";

export interface TxState {
  phase: TxPhase;
  error?: string;
}

/** Turns wallet / network failures into a sentence a person can act on. */
export function explainError(e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  if (/User rejected|rejected the request|declined|denied/i.test(msg)) return "You declined the request in your wallet. Nothing was recorded.";
  if (/signMessage|not support.*sign/i.test(msg)) return "This wallet cannot sign messages. Try Phantom, Solflare or Backpack.";
  if (/429|Too Many Requests/i.test(msg)) return "Too many requests right now. Wait a moment and try again.";
  if (/fetch failed|NetworkError|Failed to fetch/i.test(msg)) return "Could not reach TUNNEL. Check your connection and try again.";
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}

/** A fresh random nonce for a signed request (URL-safe, 22 chars). */
export function newNonce(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Signs a human-readable message with the connected wallet (free: no
 * transaction, no fees) and POSTs it to a TUNNEL endpoint. The wallet shows
 * the exact text being approved; nothing is ever signed without the user.
 */
export function useSignedRequest<T>() {
  const { publicKey, signMessage } = useWallet();
  const [state, setState] = useState<TxState>({ phase: "idle" });

  const submit = useCallback(
    async (endpoint: string, message: string): Promise<T | null> => {
      try {
        if (!publicKey) throw new Error("Connect a wallet first");
        if (!signMessage) throw new Error("This wallet does not support signMessage");
        setState({ phase: "signing" });
        const signature = encodeBase58(await signMessage(new TextEncoder().encode(message)));
        setState({ phase: "sending" });
        const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) });
        const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
        if (!res.ok) throw new Error(body.error ?? `Request failed (HTTP ${res.status})`);
        setState({ phase: "confirmed" });
        refreshMatching("state");
        refreshMatching("me:");
        return body;
      } catch (e) {
        setState({ phase: "failed", error: explainError(e) });
        return null;
      }
    },
    [publicKey, signMessage],
  );

  return { state, submit, reset: () => setState({ phase: "idle" }) };
}
