import { getDb, hasDatabase } from "@tunnel/db";
import { activity } from "@/server/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-Sent Events: pushes new protocol events to the browser.
 * Each message carries the DB id so clients can resume with Last-Event-ID.
 */
export async function GET(req: Request) {
  if (!hasDatabase()) return new Response("database not configured", { status: 503 });
  const db = getDb();
  const enc = new TextEncoder();
  const resumeFrom = req.headers.get("last-event-id");
  let cursor: bigint | undefined = resumeFrom && /^\d+$/.test(resumeFrom) ? BigInt(resumeFrom) : undefined;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => {
        if (!closed) controller.enqueue(enc.encode(s));
      };
      send("retry: 3000\n\n");
      if (cursor === undefined) {
        const latest = await db.protocolEvent.findFirst({ orderBy: { id: "desc" }, select: { id: true } }).catch(() => null);
        cursor = latest?.id ?? 0n;
      }
      while (!closed) {
        try {
          const rows = await activity(db, 50, cursor);
          for (const e of rows.reverse()) {
            cursor = e.id;
            send(`id: ${e.id}\nevent: protocol\ndata: ${JSON.stringify(e, (_, v) => (typeof v === "bigint" ? v.toString() : v))}\n\n`);
          }
          send(": keep-alive\n\n");
        } catch {
          send("event: error\ndata: database unavailable\n\n");
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    },
    cancel() {
      closed = true;
    },
  });
  req.signal.addEventListener("abort", () => {
    closed = true;
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}
