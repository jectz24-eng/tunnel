"use client";

import { useEffect, useState } from "react";
import { getJson } from "./api";

export interface ActivityEvent {
  id: string;
  name: string;
  signature: string;
  roundId: string | null;
  owner: string | null;
  blockTime: string | null;
  commitment: string;
  data: Record<string, any>;
}

/**
 * Live protocol events: seeds from /api/activity, then follows /api/stream
 * (SSE, auto-reconnecting with Last-Event-ID). `available=false` means the
 * indexer is not running — the UI says so rather than showing an empty feed.
 */
export function useActivity(limit = 30) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    getJson<ActivityEvent[]>(`/api/activity?limit=${limit}`).then((r) => {
      if (cancelled) return;
      setAvailable(r.available);
      if (!r.available) return;
      setEvents(r.data ?? []);
      es = new EventSource("/api/stream");
      es.onopen = () => setLive(true);
      es.onerror = () => setLive(false);
      es.addEventListener("protocol", (m) => {
        const e = JSON.parse((m as MessageEvent).data) as ActivityEvent;
        setEvents((prev) => (prev.some((p) => p.id === e.id) ? prev : [e, ...prev].slice(0, limit)));
      });
    });
    return () => {
      cancelled = true;
      es?.close();
    };
  }, [limit]);

  return { events, available, live };
}
