"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type Status = "anonymous" | "signing" | "verified" | "error";

interface Ctx {
  status: Status;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<Ctx>({ status: "anonymous", error: null, signIn: async () => {}, signOut: async () => {} });

/**
 * Sign-In With Solana: the wallet signs a human-readable, single-use message
 * (no transaction, no fees, no spending authority). The server verifies the
 * ed25519 signature and issues an HTTP-only session cookie for this address.
 */
export function WalletAuthProvider({ children }: { children: ReactNode }) {
  const { publicKey, signMessage } = useWallet();
  const [status, setStatus] = useState<Status>("anonymous");
  const [error, setError] = useState<string | null>(null);
  const address = publicKey?.toBase58();

  useEffect(() => {
    if (!address) {
      setStatus("anonymous");
      return;
    }
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s: { address?: string }) => setStatus(s.address === address ? "verified" : "anonymous"))
      .catch(() => setStatus("anonymous"));
  }, [address]);

  const signIn = useCallback(async () => {
    if (!address || !signMessage) {
      setError("This wallet does not support message signing.");
      setStatus("error");
      return;
    }
    setStatus("signing");
    setError(null);
    try {
      const { message } = await (await fetch(`/api/auth/nonce?address=${address}`)).json();
      const signature = await signMessage(new TextEncoder().encode(message));
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, message, signature: Array.from(signature) }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "verification failed");
      setStatus("verified");
    } catch (e) {
      setError(/reject/i.test(String(e)) ? "Signature request declined." : String((e as Error).message ?? e));
      setStatus("error");
    }
  }, [address, signMessage]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined);
    setStatus("anonymous");
  }, []);

  return <AuthContext.Provider value={{ status, error, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export const useWalletAuth = () => useContext(AuthContext);
