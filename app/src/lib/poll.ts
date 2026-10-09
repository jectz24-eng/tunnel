"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Minimal shared polling cache: one in-flight request and one timer per key,
 * no matter how many components subscribe. Keeps RPC load bounded.
 */
interface Entry<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  updatedAt: number;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
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

export function refresh(key: string) {
  const e = cache.get(key);
  if (e) void run(e);
}

export function refreshMatching(prefix: string) {
  for (const [k, e] of cache) if (k.startsWith(prefix)) void run(e);
}

export function usePoll<T>(key: string | null, fetcher: () => Promise<T>, interval = 5_000): Snapshot<T> {
  useEffect(() => {
    if (!key) return;
    let e = cache.get(key) as Entry<T> | undefined;
    if (!e) {
      e = { data: undefined, error: null, loading: true, updatedAt: 0, listeners: new Set(), timer: null, fetcher, interval, inflight: null, snapshot: EMPTY };
      cache.set(key, e);
    }
    e.fetcher = fetcher;
    if (!e.timer) {
      void run(e);
      e.timer = setInterval(() => {
        if (typeof document === "undefined" || document.visibilityState === "visible") void run(e!);
      }, interval);
    }
    return () => {
      if (e && e.listeners.size === 0 && e.timer) {
        clearInterval(e.timer);
        e.timer = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, interval]);

  return useSyncExternalStore(
    (cb) => {
      if (!key) return () => {};
      const e = cache.get(key);
      if (!e) return () => {};
      e.listeners.add(cb);
      return () => {
        e.listeners.delete(cb);
        if (e.listeners.size === 0 && e.timer) {
          clearInterval(e.timer);
          e.timer = null;
        }
      };
    },
    () => (key ? (cache.get(key)?.snapshot ?? EMPTY) : EMPTY),
    () => EMPTY,
  );
}
