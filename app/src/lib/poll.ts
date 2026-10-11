"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Minimal shared polling cache: one in-flight request and one timer per key,
 * no matter how many components subscribe. Keeps RPC load bounded.
 *
 * The timer runs while at least one subscriber exists. Unsubscribing stops it
 * only after a short grace period, because React re-subscribes during
 * re-renders and that must not stall polling.
 */
interface Entry<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  updatedAt: number;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
  stopTimer: ReturnType<typeof setTimeout> | null;
  fetcher: () => Promise<T>;
  interval: number;
  inflight: Promise<void> | null;
  snapshot: Snapshot<T>;
}

export interface Snapshot<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  updatedAt: number;
}

const cache = new Map<string, Entry<any>>();
const EMPTY: Snapshot<any> = { data: undefined, error: null, loading: true, updatedAt: 0 };

function emit(e: Entry<any>) {
  e.snapshot = { data: e.data, error: e.error, loading: e.loading, updatedAt: e.updatedAt };
  e.listeners.forEach((l) => l());
}

async function run<T>(e: Entry<T>) {
  if (e.inflight) return e.inflight;
  e.inflight = (async () => {
    try {
      e.data = await e.fetcher();
      e.error = null;
      e.updatedAt = Date.now();
    } catch (err) {
      e.error = err;
    } finally {
      e.loading = false;
      e.inflight = null;
      emit(e);
    }
  })();
  return e.inflight;
}

function start(e: Entry<any>) {
  if (e.stopTimer) {
    clearTimeout(e.stopTimer);
    e.stopTimer = null;
  }
  if (e.timer) return;
  if (!e.inflight && Date.now() - e.updatedAt > e.interval) void run(e);
  e.timer = setInterval(() => {
    if (typeof document === "undefined" || document.visibilityState === "visible") void run(e);
  }, e.interval);
}

function scheduleStop(e: Entry<any>) {
  if (e.stopTimer) clearTimeout(e.stopTimer);
  e.stopTimer = setTimeout(() => {
    e.stopTimer = null;
    if (e.listeners.size === 0 && e.timer) {
      clearInterval(e.timer);
      e.timer = null;
    }
  }, 1_000);
}

export function refresh(key: string) {
  const e = cache.get(key);
  if (e) void run(e);
}

export function refreshMatching(prefix: string) {
  for (const [k, e] of cache) if (k.startsWith(prefix)) void run(e);
}

function entry<T>(key: string, fetcher: () => Promise<T>, interval: number): Entry<T> {
  let e = cache.get(key) as Entry<T> | undefined;
  if (!e) {
    e = { data: undefined, error: null, loading: true, updatedAt: 0, listeners: new Set(), timer: null, stopTimer: null, fetcher, interval, inflight: null, snapshot: EMPTY };
    cache.set(key, e);
  }
  return e;
}

export function usePoll<T>(key: string | null, fetcher: () => Promise<T>, interval = 5_000): Snapshot<T> {
  // Keep the latest fetcher (it may close over fresh values) without restarting the timer.
  useEffect(() => {
    if (key) entry(key, fetcher, interval).fetcher = fetcher;
  });

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!key) return () => {};
      const e = entry(key, fetcher, interval);
      e.listeners.add(cb);
      start(e);
      return () => {
        e.listeners.delete(cb);
        if (e.listeners.size === 0) scheduleStop(e);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, interval],
  );

  return useSyncExternalStore(
    subscribe,
    () => (key ? (cache.get(key)?.snapshot ?? EMPTY) : EMPTY),
    () => EMPTY,
  );
}
