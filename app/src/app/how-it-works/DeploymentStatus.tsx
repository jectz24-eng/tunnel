"use client";

import { useDetectedCluster } from "@/lib/chain";
import { appConfig, clusterLabel, explorerAddress } from "@/lib/config";
import { useCasino } from "@/lib/game";

const link = (v: string | null | undefined) =>
  v ? (
    <a href={explorerAddress(v)} target="_blank" rel="noreferrer">
      {v}
    </a>
  ) : (
    "—"
  );

/** Live accelerator facts. */
export function DeploymentStatus() {
  const casino = useCasino();
  const cluster = useDetectedCluster();
  const c = casino.data;
  const rows: [string, React.ReactNode][] = [
    ["Network", clusterLabel[appConfig.cluster]],
    ["RPC reports", cluster.data ?? (cluster.error ? "unreachable" : "…")],
    ["Accelerator", c === undefined ? "…" : !c ? "unreachable" : c.bettingOpen ? "live" : "paused"],
    ["$TUNNEL mint", link(c?.tunnelMint)],
    ["Vault", link(c?.depositAddress)],
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
