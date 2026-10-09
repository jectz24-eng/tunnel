"use client";

import { formatSol, formatTunnel, type RoundAccount } from "@tunnel/sdk";
import Link from "next/link";
import { displayStatus, outcomeLabel, statusTone } from "@/lib/round";
import { Badge, Empty } from "../ui";

export function RecentRounds({ rounds, now }: { rounds: RoundAccount[]; now: number }) {
  const shown = rounds.filter((r) => r.openTs <= now);
  if (shown.length === 0) return <Empty title="No rounds yet">Rounds appear here once the protocol opens its first round.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-[12.5px]">
        <thead>
          <tr className="text-left">
            {["Round", "State", "Participants", "Particles I · II · III", "Tunnelled I · II · III", "Pool", "$TUNNEL emission", ""].map((h) => (
              <th key={h} className="label px-4 py-2.5 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono tabular">
          {shown.map((r) => {
            const st = displayStatus(r, now);
            const settled = r.status === "settled";
            return (
              <tr key={r.id.toString()} className="border-t border-line-soft">
                <td className="px-4 py-2.5 text-fg">#{r.id.toLocaleString()}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={statusTone[st]}>{settled ? outcomeLabel[r.outcome] : st}</Badge>
                </td>
                <td className="px-4 py-2.5 text-fg-2">{r.participants}</td>
                <td className="px-4 py-2.5 text-fg-2">{r.particles.map(String).join(" · ")}</td>
                <td className="px-4 py-2.5">{settled && r.outcome !== "empty" ? <span className="text-green">{r.successes.map(String).join(" · ")}</span> : <span className="text-faint">—</span>}</td>
                <td className="px-4 py-2.5 text-fg-2">{formatSol(r.totalLamports, 3)} SOL</td>
                <td className="px-4 py-2.5 text-fg-2">{r.outcome === "rewards" ? formatTunnel(r.emissionBudget, 0) : settled ? <span className="text-faint">returned</span> : formatTunnel(r.emissionBudget, 0)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/rounds/${r.id}`} className="text-[11px] text-muted hover:text-cyan">
                    verify →
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
