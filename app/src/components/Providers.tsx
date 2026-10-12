"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { MotionConfig } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { appConfig } from "@/lib/config";
import { LocalTestWalletAdapter } from "@/lib/localWallet";

/**
 * Wallets are discovered through the Wallet Standard (Phantom, Solflare,
 * Backpack and other maintained wallets register themselves), so no
 * per-wallet adapter packages are bundled. Keys never leave the wallet.
 * The local test wallet exists only on localnet with an explicit opt-in flag.
 * The RPC endpoint is set from /admin and fetched at runtime; until it loads,
 * the build-time default is used.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [endpoint, setEndpoint] = useState(appConfig.rpcUrl);
  useEffect(() => {
    fetch("/api/rpc")
      .then((r) => r.json())
      .then((j: { rpcUrl?: string }) => j.rpcUrl && setEndpoint(j.rpcUrl))
      .catch(() => undefined);
  }, []);
  const wallets = useMemo(
    () => (appConfig.cluster === "localnet" && process.env.NEXT_PUBLIC_LOCAL_TEST_WALLET === "true" ? [new LocalTestWalletAdapter(appConfig.rpcUrl)] : []),
    [],
  );
  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </WalletProvider>
    </ConnectionProvider>
  );
}
