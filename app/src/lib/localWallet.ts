"use client";

import { BaseMessageSignerWalletAdapter, WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { Connection, Keypair, LAMPORTS_PER_SOL, type PublicKey, type Transaction, type TransactionVersion, type VersionedTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";

/**
 * LOCALNET-ONLY test wallet: a throwaway keypair kept in this browser's
 * localStorage and funded from the local validator's faucet. It exists so the
 * full flow (sign in → deploy → reveal → claim) can be exercised without a
 * browser extension, including in automated tests.
 *
 * Enabled only when NEXT_PUBLIC_CLUSTER=localnet AND
 * NEXT_PUBLIC_LOCAL_TEST_WALLET=true. It never holds a user's real key and is
 * never offered on devnet or mainnet.
 */
export const LocalWalletName = "Local Test Wallet" as WalletName<"Local Test Wallet">;
const KEY = "tunnel:localnet-test-wallet";
const ICON =
  "data:image/svg+xml;base64," +
  btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0B1018"/><circle cx="16" cy="16" r="7" fill="none" stroke="#00D9FF" stroke-width="2"/><circle cx="16" cy="16" r="2.5" fill="#EAFBFF"/></svg>');

export class LocalTestWalletAdapter extends BaseMessageSignerWalletAdapter<"Local Test Wallet"> {
  name = LocalWalletName;
  url = "https://docs.solana.com/developing/test-validator";
  icon = ICON;
  readyState = typeof window === "undefined" ? WalletReadyState.Unsupported : WalletReadyState.Loadable;
  supportedTransactionVersions = new Set<TransactionVersion>(["legacy"]);
  connecting = false;
  private keypair: Keypair | null = null;

  constructor(private readonly rpcUrl: string) {
    super();
  }

  get publicKey(): PublicKey | null {
    return this.keypair?.publicKey ?? null;
  }

  async connect(): Promise<void> {
    if (this.keypair) return;
    this.connecting = true;
    try {
      let kp: Keypair;
      try {
        const saved = localStorage.getItem(KEY);
        kp = saved ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved))) : Keypair.generate();
        localStorage.setItem(KEY, JSON.stringify(Array.from(kp.secretKey)));
      } catch {
        kp = Keypair.generate();
      }
      const conn = new Connection(this.rpcUrl, "confirmed");
      if ((await conn.getBalance(kp.publicKey)) < 0.5 * LAMPORTS_PER_SOL) {
        const sig = await conn.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
        await conn.confirmTransaction({ signature: sig, ...(await conn.getLatestBlockhash()) }, "confirmed");
      }
      this.keypair = kp;
      this.emit("connect", kp.publicKey);
    } catch (e) {
      this.emit("error", e as never);
      throw e;
    } finally {
      this.connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    this.keypair = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (!this.keypair) throw new Error("wallet not connected");
    if ("version" in tx) (tx as VersionedTransaction).sign([this.keypair]);
    else (tx as Transaction).partialSign(this.keypair);
    return tx;
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this.keypair) throw new Error("wallet not connected");
    return nacl.sign.detached(message, this.keypair.secretKey);
  }
}
