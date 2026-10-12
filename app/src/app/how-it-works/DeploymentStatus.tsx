"use client";

import { useDetectedCluster, useProtocol } from "@/lib/chain";
import { appConfig, clusterLabel, explorerAddress } from "@/lib/config";

const link = (v: string | null | undefined) =>
  v ? (
    <a href={explorerAddress(v)} target="_blank" rel="noreferrer">
      {v}
    </a>
  ) : (
    "—"
  );

/** Live deployment facts. */
export function DeploymentStatus() {
  const protocol = useProtocol();
  const cluster = useDetectedCluster();
  const p = protocol.data;
  const rows: [string, React.ReactNode][] = [
    ["Token network", clusterLabel[appConfig.cluster]],
    ["RPC reports", cluster.data ?? (cluster.error ? "unreachable" : "…")],
    ["TUNNEL server", protocol.loading && p === undefined ? "…" : p ? "online" : "unreachable"],
    ["Cycle engine", p ? (p.engineOnline ? "running" : "offline") : "—"],
    ["$TUNNEL mint", link(p?.tunnelMint)],
    ["Reward wallet", link(p?.rewardWallet)],
    ["Mining", p ? (p.paused ? "paused" : "running") : "—"],
    ["Smart contract", "none: game logic runs on the TUNNEL server; rewards are real SPL transfers"],
    ["Independent audit", "not performed"],
  ];
  return (
    <table>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td>{k}</td>
            <td className="break-all font-mono text-xs">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
