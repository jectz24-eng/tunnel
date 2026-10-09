import type { NextRequest } from "next/server";
import { isBase58Address, json } from "@/server/http";
import { buildSignInMessage } from "@/server/session";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!isBase58Address(address)) return json({ error: "invalid address" }, { status: 400 });
  return json({ message: buildSignInMessage(address, req.nextUrl.origin) });
}
