"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { Connection, PublicKey } from "@solana/web3.js";
import {
  fetchOwnerPositions,
  fetchProtocol,
  fetchRounds,
  type PositionAccount,
  type ProtocolAccount,
  type RoundAccount,
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

// ---------------------------------------------------------------- protocol + rounds

export function useProtocol() {
  const { connection } = useConnection();
  return usePoll<ProtocolAccount | null>("protocol", () => fetchProtocol(connection, appConfig.programId), 4_000);
}

export interface RoundView {
  /** Round currently accepting deposits (open_ts ≤ now < close_ts), if any. */
  current: RoundAccount | null;
  /** Round scheduled to start when the current one ends. */
  upcoming: RoundAccount | null;
  /** Most recent rounds, newest first (including current). */
  recent: RoundAccount[];
}

export function useRounds(count = 12) {
  const { connection } = useConnection();
  const protocol = useProtocol();
  const next = protocol.data?.nextRoundId;
  const snap = usePoll<RoundAccount[]>(
    next != null ? `rounds:${next}:${count}` : null,
    async () => {
      const ids: bigint[] = [];
      for (let i = next! - 1n; i >= 0n && ids.length < count; i--) ids.push(i);
      return (await fetchRounds(connection, ids, appConfig.programId)).filter((r): r is RoundAccount => !!r);
    },
    2_000,
  );
  return { ...snap, protocol };
}

export function splitRounds(rounds: RoundAccount[] | undefined, now: number): RoundView {
  const recent = rounds ?? [];
  const upcoming = recent.find((r) => r.status === "open" && r.openTs > now) ?? null;
  const current = recent.find((r) => r.status === "open" && r.openTs <= now && now < r.closeTs) ?? null;
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

export function useOwnerPositions() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  return usePoll<PositionAccount[]>(
    publicKey ? `positions:${publicKey.toBase58()}` : null,
    async () => {
      const list = await fetchOwnerPositions(connection, publicKey!, appConfig.programId);
      return list.sort((a, b) => (a.roundId < b.roundId ? 1 : -1));
    },
    6_000,
  );
}

export function useRoundsById(ids: bigint[]) {
  const { connection } = useConnection();
  const key = ids.length ? `roundsById:${ids.join(",")}` : null;
  return usePoll<Map<string, RoundAccount>>(
    key,
    async () => {
      const rs = await fetchRounds(connection, ids, appConfig.programId);
      return new Map(rs.filter((r): r is RoundAccount => !!r).map((r) => [r.id.toString(), r]));
    },
    6_000,
  );
}
