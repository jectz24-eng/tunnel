"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import type { ReactNode } from "react";
import { appConfig } from "@/lib/config";

/**
 * Wallets are discovered through the Wallet Standard (Phantom, Solflare,
 * Backpack and other maintained wallets register themselves), so no
 * per-wallet adapter packages are bundled. Keys never leave the wallet.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConnectionProvider endpoint={appConfig.rpcUrl} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={[]} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
