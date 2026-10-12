"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useState } from "react";
import { getJson } from "./api";
import { usePoll } from "./poll";
import { parseCycle, parsePayout, parsePosition, parseProtocol, type CycleAccount, type Payout, type PositionAccount, type ProtocolAccount } from "./types";

export type { CycleAccount, PositionAccount, ProtocolAccount } from "./types";

const GENESIS: Record<string, string> = {
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": "mainnet-beta",
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: "devnet",
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY": "testnet",
};

/** Detects the RPC's actual cluster from its genesis hash (the URL alone can be misconfigured). */
export function useDetectedCluster() {
  const { connection } = useConnection();
  return usePoll("cluster", async () => GENESIS[await connection.getGenesisHash()] ?? "localnet", 300_000);
}

// ---------------------------------------------------------------- server state

interface LiveState {
  protocol: ProtocolAccount;
  current: CycleAccount | null;
  recent: CycleAccount[];
}

let clockOffsetMs = 0;
let clockSynced = false;

async function fetchState(): Promise<LiveState | null> {
  const t0 = Date.now();
  const r = await getJson<{ now: number; config: Record<string, unknown>; totals: Record<string, unknown>; current: unknown; recent: unknown[] }>("/api/state");
  if (!r.available || !r.data) return null;
  // Server clock: deadlines are enforced by the server, so countdowns follow it.
  clockOffsetMs = r.data.now - (t0 + Date.now()) / 2;
  clockSynced = true;
  return {
    protocol: parseProtocol(r.data.config, r.data.totals),
    current: r.data.current ? parseCycle(r.data.current as Record<string, unknown>) : null,
    recent: r.data.recent.map((c) => parseCycle(c as Record<string, unknown>)),
  };
}

/** Live protocol state (one shared poll). `data === null` means the service is unavailable. */
export function useLiveState() {
  return usePoll<LiveState | null>("state", fetchState, 2_500);
}

/** Server time in seconds. */
export function chainNow() {
  return (Date.now() + clockOffsetMs) / 1000;
}

export function useChainClock(tickMs = 250) {
  useLiveState();
  const [now, setNow] = useState(() => chainNow());
  useEffect(() => {
    const id = setInterval(() => setNow(chainNow()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  return { now, synced: clockSynced };
}

export function useProtocol() {
  const s = useLiveState();
  return { ...s, data: s.data === undefined ? undefined : (s.data?.protocol ?? null) };
}

export interface CycleView {
  /** Cycle currently accepting particles, if any. */
  current: CycleAccount | null;
  /** Most recent cycles, newest first (including current). */
  recent: CycleAccount[];
}

export function useCycles() {
  const s = useLiveState();
  return { ...s, data: s.data?.recent, protocol: { ...s, data: s.data?.protocol ?? (s.data === null ? null : undefined) } };
}

export function splitCycles(cycles: CycleAccount[] | undefined, now: number): CycleView {
  const recent = cycles ?? [];
  const current = recent.find((c) => c.status === "open" && now < c.closeTs) ?? null;
  return { current, recent };
}

// ---------------------------------------------------------------- wallet

interface WalletState {
  positions: PositionAccount[];
  claimable: { amount: bigint; cycles: number };
  payouts: Payout[];
}

export function useWalletState() {
  const { publicKey } = useWallet();
  const key = publicKey?.toBase58();
  return usePoll<WalletState | null>(
    key ? `me:${key}` : null,
    async () => {
      const r = await getJson<{ positions: Record<string, unknown>[]; claimable: { amount: string; cycles: number }; payouts: Record<string, unknown>[] }>(`/api/me?wallet=${key}`);
      if (!r.available || !r.data) return null;
      return {
        positions: r.data.positions.map(parsePosition),
        claimable: { amount: BigInt(r.data.claimable.amount), cycles: r.data.claimable.cycles },
        payouts: r.data.payouts.map(parsePayout),
      };
    },
    3_000,
  );
}

/** The connected wallet's recent positions, newest first. */
export function useOwnerPositions() {
  const s = useWalletState();
  return { ...s, data: s.data?.positions };
}

/** The connected wallet's position in one cycle (null when it has not deployed). */
export function usePosition(cycleId: bigint | null | undefined) {
  const s = useWalletState();
  const data = s.data === undefined ? undefined : cycleId == null ? null : (s.data?.positions.find((p) => p.cycleId === cycleId) ?? null);
  return { ...s, data };
}

/** SOL and $TUNNEL balances of a wallet, read from chain. */
export function useBalances(owner: PublicKey | null) {
  const { connection } = useConnection();
  const protocol = useProtocol();
  const mint = protocol.data?.tunnelMint;
  return usePoll(
    owner ? `balances:${owner.toBase58()}:${mint ?? "-"}` : null,
    async () => {
      const lamports = BigInt(await connection.getBalance(owner!, "confirmed"));
      let tunnel: bigint | null = null;
      if (mint) {
        try {
          const mintKey = new PublicKey(mint);
          const program = (await connection.getAccountInfo(mintKey))?.owner;
          const ata = getAssociatedTokenAddressSync(mintKey, owner!, true, program);
          tunnel = BigInt((await connection.getTokenAccountBalance(ata, "confirmed")).value.amount);
        } catch {
          tunnel = 0n;
        }
      }
      return { lamports, tunnel };
    },
    8_000,
  );
}

/** One cycle from the server (for detail pages). */
export function useCycle(id: bigint | null) {
  return usePoll<CycleAccount | null>(
    id != null ? `cycle:${id}` : null,
    async () => {
      const r = await getJson<{ cycle: Record<string, unknown> }>(`/api/cycles/${id}`);
      return r.available && r.data ? parseCycle(r.data.cycle) : null;
    },
    5_000,
  );
}
