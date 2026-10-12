"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { MotionConfig } from "motion/react";
import { useMemo, type ReactNode } from "react";
import { appConfig } from "@/lib/config";
import { LocalTestWalletAdapter } from "@/lib/localWallet";

/**
 * Wallets are discovered through the Wallet Standard (Phantom, Solflare,
 * Backpack and other maintained wallets register themselves), so no
 * per-wallet adapter packages are bundled. Keys never leave the wallet.
 * The local test wallet exists only on localnet with an explicit opt-in flag.
 */
export function Providers({ children }: { children: ReactNode }) {
  const wallets = useMemo(
    () => (appConfig.cluster === "localnet" && process.env.NEXT_PUBLIC_LOCAL_TEST_WALLET === "true" ? [new LocalTestWalletAdapter(appConfig.rpcUrl)] : []),
    [],
  );
  return (
    <ConnectionProvider endpoint={appConfig.rpcUrl} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </WalletProvider>
    </ConnectionProvider>
  );
}
