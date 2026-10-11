"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { Connection, PublicKey } from "@solana/web3.js";
import {
  fetchCycles,
  fetchOwnerPositions,
  fetchPosition,
  fetchProtocol,
  type CycleAccount,
  type PositionAccount,
  type ProtocolAccount,
} from "@tunnel/sdk";
import { useEffect, useState } from "react";
import { appConfig } from "./config";
import { usePoll } from "./poll";

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

// ---------------------------------------------------------------- chain clock

let clockOffsetMs = 0;
let clockSynced = false;

async function syncClock(connection: Connection) {
  const slot = await connection.getSlot("confirmed");
  const t = await connection.getBlockTime(slot);
  if (t != null) {
    clockOffsetMs = t * 1000 - Date.now();
    clockSynced = true;
  }
  return clockOffsetMs;
}

/** Chain time in seconds. Program deadlines use `Clock::unix_timestamp`, so countdowns follow it too. */
export function chainNow() {
  return (Date.now() + clockOffsetMs) / 1000;
}

export function useChainClock(tickMs = 250) {
  const { connection } = useConnection();
  usePoll("clock", () => syncClock(connection), 30_000);
  const [now, setNow] = useState(() => chainNow());
  useEffect(() => {
    const id = setInterval(() => setNow(chainNow()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  return { now, synced: clockSynced };
}

// ---------------------------------------------------------------- protocol + cycles

export function useProtocol() {
  const { connection } = useConnection();
  return usePoll<ProtocolAccount | null>("protocol", () => fetchProtocol(connection, appConfig.programId), 4_000);
}

export interface CycleView {
  /** Cycle currently accepting particles (open_ts ≤ now < close_ts), if any. */
  current: CycleAccount | null;
  /** Cycle scheduled to start when the current one ends. */
  upcoming: CycleAccount | null;
  /** Most recent cycles, newest first (including current). */
  recent: CycleAccount[];
}

export function useCycles(count = 12) {
  const { connection } = useConnection();
  const protocol = useProtocol();
  const next = protocol.data?.nextCycleId;
  const snap = usePoll<CycleAccount[]>(
    next != null ? `cycles:${next}:${count}` : null,
    async () => {
      const ids: bigint[] = [];
      for (let i = next! - 1n; i >= 0n && ids.length < count; i--) ids.push(i);
      return (await fetchCycles(connection, ids, appConfig.programId)).filter((c): c is CycleAccount => !!c);
    },
    2_500,
  );
  return { ...snap, protocol };
}

export function splitCycles(cycles: CycleAccount[] | undefined, now: number): CycleView {
  const recent = cycles ?? [];
  const upcoming = recent.find((c) => c.status === "open" && c.openTs > now) ?? null;
  const current = recent.find((c) => c.status === "open" && c.openTs <= now && now < c.closeTs) ?? null;
  return { current, upcoming, recent };
}

// ---------------------------------------------------------------- wallet

export function useBalances(owner: PublicKey | null) {
  const { connection } = useConnection();
  const protocol = useProtocol();
  const mint = protocol.data?.tunnelMint;
  return usePoll(
    owner ? `balances:${owner.toBase58()}:${mint?.toBase58() ?? "-"}` : null,
    async () => {
      const lamports = BigInt(await connection.getBalance(owner!, "confirmed"));
      let tunnel: bigint | null = null;
      if (mint) {
        try {
          const ata = getAssociatedTokenAddressSync(mint, owner!);
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

/** Every open position of the connected wallet (claimed positions are closed onchain). */
export function useOwnerPositions() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  return usePoll<PositionAccount[]>(
    publicKey ? `positions:${publicKey.toBase58()}` : null,
    async () => {
      const list = await fetchOwnerPositions(connection, publicKey!, appConfig.programId);
      return list.sort((a, b) => (a.cycleId < b.cycleId ? 1 : -1));
    },
    5_000,
  );
}

/** The connected wallet's position in one cycle (null when it has not deployed). */
export function usePosition(cycleId: bigint | null | undefined) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  return usePoll<PositionAccount | null>(
    publicKey && cycleId != null ? `positions:one:${publicKey.toBase58()}:${cycleId}` : null,
    () => fetchPosition(connection, cycleId!, publicKey!, appConfig.programId),
    3_000,
  );
}

export function useCyclesById(ids: bigint[]) {
  const { connection } = useConnection();
  const key = ids.length ? `cyclesById:${ids.join(",")}` : null;
  return usePoll<Map<string, CycleAccount>>(
    key,
    async () => {
      const cs = await fetchCycles(connection, ids, appConfig.programId);
      return new Map(cs.filter((c): c is CycleAccount => !!c).map((c) => [c.id.toString(), c]));
    },
    5_000,
  );
}

/** Rent the position account locks while open (returned in full by claim). */
export function usePositionRent() {
  const { connection } = useConnection();
  return usePoll("rent:position", async () => BigInt(await connection.getMinimumBalanceForRentExemption(8 + 123)), 600_000);
}
