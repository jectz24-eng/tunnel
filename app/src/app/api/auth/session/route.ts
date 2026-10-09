import type { NextRequest } from "next/server";
import { json } from "@/server/http";
import { SESSION_COOKIE, readSession } from "@/server/session";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return json({ address: readSession(req.cookies.get(SESSION_COOKIE)?.value) });
}

export function DELETE() {
  const res = json({ address: null });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
