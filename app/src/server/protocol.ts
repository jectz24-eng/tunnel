import "server-only";
import { isProtocolError } from "@tunnel/core";
import { json } from "./http";

/** Maps a protocol rejection to a clean JSON error; anything else is a 500 that never leaks internals. */
export function protocolErrorResponse(e: unknown) {
  if (isProtocolError(e)) return json({ error: e.message, code: e.code }, { status: e.status });
  console.error("[api] unexpected error", e);
  return json({ error: "Something went wrong on our side. Nothing was recorded; please try again.", code: "internal" }, { status: 500 });
}
