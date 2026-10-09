import { PublicKey } from "@solana/web3.js";
import type { NextRequest } from "next/server";
import nacl from "tweetnacl";
import { isBase58Address, json } from "@/server/http";
import { SESSION_COOKIE, checkSignInMessage, issueSession } from "@/server/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { address?: string; message?: string; signature?: number[] } | null;
  if (!body || !isBase58Address(body.address ?? null) || typeof body.message !== "string" || !Array.isArray(body.signature)) {
    return json({ error: "malformed request" }, { status: 400 });
  }
  const problem = checkSignInMessage(body.message, body.address!, req.nextUrl.origin);
  if (problem) return json({ error: problem }, { status: 401 });

  const ok = nacl.sign.detached.verify(
    new TextEncoder().encode(body.message),
    Uint8Array.from(body.signature),
    new PublicKey(body.address!).toBytes(),
  );
  if (!ok) return json({ error: "signature does not match address" }, { status: 401 });

  const session = issueSession(body.address!);
  const res = json({ address: body.address });
  res.cookies.set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: session.maxAge,
  });
  return res;
}
