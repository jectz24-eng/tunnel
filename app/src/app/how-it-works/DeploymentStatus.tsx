"use client";

import { isGatekeeperEnabled } from "@tunnel/sdk";
import { useDetectedCluster, useProtocol } from "@/lib/chain";
import { appConfig, clusterLabel, explorerAddress } from "@/lib/config";

/** Live deployment facts read from the configured cluster. */
export function DeploymentStatus() {
  const protocol = useProtocol();
  const cluster = useDetectedCluster();
  const p = protocol.data;
  const rows: [string, React.ReactNode][] = [
    ["Configured cluster", clusterLabel[appConfig.cluster]],
    ["RPC reports", cluster.data ?? (cluster.error ? "unreachable" : "…")],
    ["Program", <a key="p" href={explorerAddress(appConfig.programId.toBase58())} target="_blank" rel="noreferrer">{appConfig.programId.toBase58()}</a>],
    ["Initialized", protocol.loading && p === undefined ? "…" : p ? "yes" : protocol.error ? "unknown (RPC error)" : "no"],
    ["Admin", p ? <a key="a" href={explorerAddress(p.admin.toBase58())} target="_blank" rel="noreferrer">{p.admin.toBase58()}</a> : "—"],
    ["$TUNNEL mint", p ? <a key="m" href={explorerAddress(p.tunnelMint.toBase58())} target="_blank" rel="noreferrer">{p.tunnelMint.toBase58()}</a> : "—"],
    ["Gatekeeper co-signing", p ? (isGatekeeperEnabled(p) ? "required" : "off") : "—"],
    ["Paused", p ? (p.paused ? "yes" : "no") : "—"],
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
