import { BARRIER_META, LEVEL_LABELS, formatTunnel, shortKey } from "@tunnel/sdk";
import Link from "next/link";
import type { ActivityEvent } from "@/lib/stream";
import { explorerTx } from "@/lib/config";
import { Dot } from "./ui";

/** One human-readable line for a protocol event. */
export function ActivityLine({ e, compact }: { e: ActivityEvent; compact?: boolean }) {
  const d = e.data;
  const who = e.owner ? (
    <Link href={`/profile/${e.owner}`} className="font-mono text-fg-2 hover:text-cyan">
      {shortKey(e.owner)}
    </Link>
  ) : null;
  const cycle = (
    <Link href={`/history/cycle/${e.cycleId}`} className="text-fg-2 hover:text-cyan">
      {e.cycleId}
    </Link>
  );
  let dot = "#81909F";
  let text: React.ReactNode = e.name;
  switch (e.name) {
    case "ParticlesDeployed": {
      const m = BARRIER_META[Number(d.barrier)];
      dot = m?.color ?? dot;
      text = (
        <>
          {who} deployed <b className="font-medium text-fg">{d.count}</b> particle{Number(d.count) === 1 ? "" : "s"} · {m?.short} · {LEVEL_LABELS[Number(d.level)]}
        </>
      );
      break;
    }
    case "RewardClaimed":
      dot = "#EAFBFF";
      text = (
        <>
          {who} received <b className="font-medium text-flare">{formatTunnel(BigInt(d.amount))}</b> $TUNNEL
        </>
      );
      break;
    case "ClaimRequested":
      dot = "#81909F";
      text = <>{who} requested a payout</>;
      break;
    case "CycleSettled": {
      const s = (d.successes as string[]).reduce((a, b) => a + Number(b), 0);
      dot = "#00D9FF";
      text = (
        <>
          Cycle {cycle} settled ·{" "}
          {d.outcome === "empty" ? (
            "no participants"
          ) : (
            <>
              <b className="font-medium text-cyan">{s}</b> tunneled
            </>
          )}
        </>
      );
      break;
    }
    case "CycleOpened":
      dot = "#2864FF";
      text = <>Cycle {e.cycleId} opened · budget {formatTunnel(BigInt(d.emissionBudget), 0)} $TUNNEL</>;
      break;
    case "CycleClosed":
      dot = "#F0A64B";
      text = <>Cycle {cycle} closed · waiting for the entropy block</>;
      break;
    case "CycleVoided":
      dot = "#FF6B7D";
      text = <>Cycle {cycle} voided · not settled</>;
      break;
  }
  const time = new Date(e.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <div className="flex items-center gap-3 text-[13px] text-muted">
      <Dot color={dot} />
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {!compact &&
        (e.name === "RewardClaimed" && d.txSignature ? (
          <a href={explorerTx(String(d.txSignature))} target="_blank" rel="noreferrer" className="shrink-0 font-mono text-[10.5px] text-faint hover:text-cyan">
            {time}
          </a>
        ) : (
          <span className="shrink-0 font-mono text-[10.5px] text-faint">{time}</span>
        ))}
    </div>
  );
}
