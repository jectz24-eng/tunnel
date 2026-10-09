"use client";

import { usePoll } from "./poll";

/** Indexed (database-backed) data. Always optional: the UI states when the indexer is unavailable. */
export interface Indexed<T> {
  available: boolean;
  data?: T;
  reason?: string;
}

export async function getJson<T>(path: string): Promise<Indexed<T>> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) return { available: false, reason: `HTTP ${res.status}` };
  return res.json();
}

export function useIndexed<T>(path: string | null, interval = 10_000) {
  return usePoll<Indexed<T>>(path ? `api:${path}` : null, () => getJson<T>(path!), interval);
}
