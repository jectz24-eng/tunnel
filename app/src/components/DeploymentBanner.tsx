"use client";

import Link from "next/link";
import { useProtocol } from "@/lib/chain";
import { appConfig, clusterLabel } from "@/lib/config";

/**
 * States plainly when the program isn't deployed/initialized on the configured
 * cluster, so empty values are never mistaken for real zeroes.
 */
export function DeploymentBanner() {
  const protocol = useProtocol();
  if (protocol.loading && protocol.data === undefined) return null;

  if (protocol.error) {
    return (
      <Bar tone="red">
        Cannot reach the {clusterLabel[appConfig.cluster]} RPC endpoint. Onchain values are unavailable until it recovers.
      </Bar>
    );
  }
  if (protocol.data === null) {
    return (
      <Bar tone="amber">
        The TUNNEL program is not initialized on {clusterLabel[appConfig.cluster]} yet. Mining is disabled and statistics are empty, not zero.{" "}
        <Link href="/docs#deployment" className="underline underline-offset-4">
          Deployment status
        </Link>
      </Bar>
    );
  }
  if (protocol.data?.paused) {
    return <Bar tone="amber">New deposits are paused by the protocol admin. Settlement, claims and refunds remain available.</Bar>;
  }
  if (!appConfig.depositsEnabled) {
    return <Bar tone="amber">Mainnet deposits are disabled in this build pending owner authorization and an independent audit.</Bar>;
  }
  return null;
}

function Bar({ tone, children }: { tone: "amber" | "red"; children: React.ReactNode }) {
  return (
    <div className={tone === "red" ? "border-b border-red/20 bg-red/[0.06]" : "border-b border-amber/20 bg-amber/[0.05]"}>
      <div className={`mx-auto max-w-[1400px] px-4 py-2 text-center text-xs sm:px-6 ${tone === "red" ? "text-red" : "text-amber"}`}>{children}</div>
    </div>
  );
}
