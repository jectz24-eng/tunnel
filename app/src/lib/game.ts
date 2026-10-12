"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { TUNNEL_UNIT, VOLATILITY, hashServerSeed, randomSeedHex, resolveBet } from "@tunnel/sdk";
import { useCallback, useEffect, useState } from "react";
import { useWalletAuth } from "@/components/WalletAuth";
import { getJson } from "./api";
import { refreshMatching, usePoll } from "./poll";

/** One resolved bet, as the UI shows it. */
export interface BetView {
  id: string;
  volatility: number;
  amount: bigint;
  count: number;
  stake: bigint;
  hits: boolean[];
  wins: number;
  payout: bigint;
  multiplierBps: number;
  nonce: number;
  createdAt: string;
}

export interface SeedView {
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

export type GameStatus = "loading" | "connect" | "signin" | "offline" | "paused" | "ready";

export interface GameEngine {
  mode: "live" | "practice";
  status: GameStatus;
  balance: bigint | null;
  minBet: bigint;
  maxBet: bigint;
  /** Largest net win one bet may have (null: no limit). */
  maxWin: bigint | null;
  seed: SeedView | null;
  history: BetView[];
  fire(volatility: number, amount: bigint, count: number): Promise<{ ok: true; bet: BetView; balance: bigint } | { ok: false; error: string }>;
  rotate(clientSeed?: string): Promise<{ ok: true; revealedSeed: string; revealedHash: string } | { ok: false; error: string }>;
}

/** Bet-size presets shown as energy levels E1–E5 (whole $TUNNEL). */
export const BET_PRESETS = [10, 50, 100, 500, 1_000].map((n) => BigInt(n) * TUNNEL_UNIT);

const big = (v: unknown) => BigInt((v as string | number | bigint) ?? 0);
/* eslint-disable @typescript-eslint/no-explicit-any */
const parseBet = (b: any, hits?: boolean[]): BetView => ({
  id: String(b.id),
  volatility: b.volatility,
  amount: big(b.amount),
  count: b.count,
  stake: big(b.stake),
  hits: hits ?? String(b.outcomeBits).split("").map((c) => c === "1"),
  wins: b.wins,
  payout: big(b.payout),
  multiplierBps: b.multiplierBps,
  nonce: b.nonce,
  createdAt: b.createdAt,
});

// ---------------------------------------------------------------- live (server)

export interface CasinoState {
  bettingOpen: boolean;
  minBet: bigint;
  maxBet: bigint;
  maxWin: bigint | null;
  depositAddress: string | null;
  tunnelMint: string | null;
  engineOnline: boolean;
  totals: { bets: number; particles: number; hits: number; wagered: bigint; biggestWin: bigint };
}

export function useCasino() {
  return usePoll<CasinoState | null>(
    "casino:state",
    async () => {
      const r = await getJson<any>("/api/casino");
      if (!r.available || !r.data) return null;
      const d = r.data;
      return {
        bettingOpen: d.bettingOpen,
        minBet: big(d.minBet),
        maxBet: big(d.maxBet),
        maxWin: d.maxWin == null ? null : big(d.maxWin),
        depositAddress: d.depositAddress,
        tunnelMint: d.tunnelMint,
        engineOnline: d.engineOnline,
        totals: { ...d.totals, wagered: big(d.totals.wagered), biggestWin: big(d.totals.biggestWin) },
      };
    },
    4_000,
  );
}

export interface PlayerState {
  balance: bigint;
  seed: SeedView;
  bets: BetView[];
  withdrawals: { id: string; amount: bigint; status: string; txSignature: string | null; createdAt: string }[];
  deposits: { id: string; amount: bigint; txSignature: string; createdAt: string }[];
}

export function usePlayer() {
  const { publicKey } = useWallet();
  const auth = useWalletAuth();
  const key = publicKey && auth.status === "verified" ? `casino:me:${publicKey.toBase58()}` : null;
  return usePoll<PlayerState | null>(
    key,
    async () => {
      const r = await getJson<any>("/api/casino/me");
      if (!r.available || !r.data) return null;
      const d = r.data;
      return {
        balance: big(d.balance),
        seed: { serverSeedHash: d.seed.serverSeedHash, clientSeed: d.seed.clientSeed, nonce: d.seed.nonce },
        bets: d.bets.map((b: any) => parseBet(b)),
        withdrawals: d.withdrawals.map((w: any) => ({ ...w, id: String(w.id), amount: big(w.amount) })),
        deposits: d.deposits.map((x: any) => ({ ...x, id: String(x.id), amount: big(x.amount) })),
      };
    },
    3_000,
  );
}

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: j as any };
}

export function useLiveGame(): GameEngine {
  const { publicKey } = useWallet();
  const auth = useWalletAuth();
  const casino = useCasino();
  const player = usePlayer();
  const [optimistic, setOptimistic] = useState<{ balance: bigint; at: number } | null>(null);

  const c = casino.data;
  const status: GameStatus =
    casino.data === undefined ? "loading" : !c || !c.engineOnline ? "offline" : !publicKey ? "connect" : auth.status !== "verified" ? "signin" : !c.bettingOpen ? "paused" : "ready";

  // Use the balance returned by the last bet until a newer poll arrives.
  const polled = player.data?.balance ?? null;
  const balance = optimistic && player.updatedAt < optimistic.at ? optimistic.balance : polled;

  const fire = useCallback<GameEngine["fire"]>(async (volatility, amount, count) => {
    const r = await post("/api/casino/bet", { volatility, amount: amount.toString(), count });
    if (!r.ok) {
      if (r.status === 401) return { ok: false, error: "Sign in with your wallet to play." };
      return { ok: false, error: r.body.error ?? "The bet did not go through. Try again." };
    }
    const bet = parseBet(r.body.bet, r.body.hits);
    const bal = big(r.body.balance);
    setOptimistic({ balance: bal, at: Date.now() });
    refreshMatching("casino:");
    return { ok: true, bet, balance: bal };
  }, []);

  const rotate = useCallback<GameEngine["rotate"]>(async (clientSeed) => {
    const r = await post("/api/casino/seed", { clientSeed });
    if (!r.ok) return { ok: false, error: r.body.error ?? "Could not rotate seeds." };
    refreshMatching("casino:");
    return { ok: true, revealedSeed: r.body.revealed.serverSeed, revealedHash: r.body.revealed.serverSeedHash };
  }, []);

  return {
    mode: "live",
    status,
    balance,
    minBet: c?.minBet ?? TUNNEL_UNIT,
    maxBet: c?.maxBet ?? 1_000n * TUNNEL_UNIT,
    maxWin: c?.maxWin ?? null,
    seed: player.data?.seed ?? null,
    history: player.data?.bets ?? [],
    fire,
    rotate,
  };
}

// ---------------------------------------------------------------- practice (browser only)

const PRACTICE_KEY = "tunnel:practice:v1";
export const PRACTICE_START = 10_000n * TUNNEL_UNIT;

interface PracticeStore {
  balance: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  history: { id: string; volatility: number; amount: string; count: number; bits: string; payout: string; nonce: number; createdAt: string }[];
  nextId: number;
}

const freshPractice = (): PracticeStore => ({ balance: PRACTICE_START.toString(), serverSeed: randomSeedHex(), clientSeed: randomSeedHex(8), nonce: 0, history: [], nextId: 1 });

function loadPractice(): PracticeStore {
  try {
    const raw = localStorage.getItem(PRACTICE_KEY);
    if (raw) return JSON.parse(raw) as PracticeStore;
  } catch {
    /* storage unavailable */
  }
  return freshPractice();
}

function savePractice(s: PracticeStore) {
  try {
    localStorage.setItem(PRACTICE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

/** Practice mode: identical odds and draw function, free credits, everything stays in this browser. */
export function usePracticeGame(): GameEngine & { reset: () => void } {
  const [store, setStore] = useState<PracticeStore | null>(null);
  useEffect(() => setStore(loadPractice()), []);

  const update = (s: PracticeStore) => {
    savePractice(s);
    setStore(s);
  };

  const fire = useCallback<GameEngine["fire"]>(async (volatility, amount, count) => {
    const s = loadPractice();
    const stake = amount * BigInt(count);
    if (BigInt(s.balance) < stake) return { ok: false, error: "Not enough practice credits. Reset to top up." };
    const out = resolveBet({ serverSeed: s.serverSeed, clientSeed: s.clientSeed, nonce: s.nonce, volatility, amount, count });
    const bet: BetView = {
      id: `P${s.nextId}`,
      volatility,
      amount,
      count,
      stake,
      hits: out.hits,
      wins: out.wins,
      payout: out.payout,
      multiplierBps: VOLATILITY[volatility].multiplierBps,
      nonce: s.nonce,
      createdAt: new Date().toISOString(),
    };
    const balance = BigInt(s.balance) - stake + out.payout;
    update({
      ...s,
      balance: balance.toString(),
      nonce: s.nonce + 1,
      nextId: s.nextId + 1,
      history: [{ id: bet.id, volatility, amount: amount.toString(), count, bits: out.hits.map((h) => (h ? "1" : "0")).join(""), payout: out.payout.toString(), nonce: bet.nonce, createdAt: bet.createdAt }, ...s.history].slice(0, 50),
    });
    return { ok: true, bet, balance };
  }, []);

  const rotate = useCallback<GameEngine["rotate"]>(async (clientSeed) => {
    const s = loadPractice();
    update({ ...s, serverSeed: randomSeedHex(), clientSeed: clientSeed || randomSeedHex(8), nonce: 0 });
    return { ok: true, revealedSeed: s.serverSeed, revealedHash: hashServerSeed(s.serverSeed) };
  }, []);

  const reset = useCallback(() => update(freshPractice()), []);

  return {
    mode: "practice",
    status: store ? "ready" : "loading",
    balance: store ? BigInt(store.balance) : null,
    minBet: TUNNEL_UNIT,
    maxBet: 1_000n * TUNNEL_UNIT,
    maxWin: null,
    seed: store ? { serverSeedHash: hashServerSeed(store.serverSeed), clientSeed: store.clientSeed, nonce: store.nonce } : null,
    history: (store?.history ?? []).map((h) => ({
      id: h.id,
      volatility: h.volatility,
      amount: BigInt(h.amount),
      count: h.count,
      stake: BigInt(h.amount) * BigInt(h.count),
      hits: h.bits.split("").map((c) => c === "1"),
      wins: h.bits.split("").filter((c) => c === "1").length,
      payout: BigInt(h.payout),
      multiplierBps: VOLATILITY[h.volatility].multiplierBps,
      nonce: h.nonce,
      createdAt: h.createdAt,
    })),
    fire,
    rotate,
    reset,
  };
}
