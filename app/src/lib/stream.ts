"use client";

import { useEffect, useRef, useState } from "react";
import { getJson } from "./api";

export interface ActivityEvent {
  id: string;
  name: string;
  cycleId: string | null;
  owner: string | null;
  createdAt: string;
  data: Record<string, any>;
}

/**
 * Live protocol events: seeds from /api/activity, then follows /api/stream
 * (SSE, auto-reconnecting with Last-Event-ID). `available=false` means the
 * service is unreachable — the UI says so rather than showing an empty feed.
 * `onLive` fires only for events that arrive after the page loaded.
 */
export function useActivity(limit = 30, onLive?: (e: ActivityEvent) => void) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [live, setLive] = useState(false);
  const cb = useRef(onLive);
  cb.current = onLive;

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    getJson<ActivityEvent[]>(`/api/activity?limit=${limit}`)
      .then((r) => {
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
          cb.current?.(e);
        });
      })
      .catch(() => !cancelled && setAvailable(false));
    return () => {
      cancelled = true;
      es?.close();
    };
  }, [limit]);

  return { events, available, live };
}
