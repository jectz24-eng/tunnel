import type { NextRequest } from "next/server";
import { indexed, isBase58Address, json } from "@/server/http";
import { walletState } from "@/server/queries";

export const dynamic = "force-dynamic";

/** A wallet's positions, claimable balance and payouts (all public protocol data). */
export function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!isBase58Address(wallet)) return json({ error: "invalid address" }, { status: 400 });
  return indexed((db) => walletState(db, wallet));
}
