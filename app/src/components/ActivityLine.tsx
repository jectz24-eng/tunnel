import { BARRIER_META, LEVEL_LABELS, formatTunnel, shortKey } from "@tunnel/sdk";
import Link from "next/link";
import type { ActivityEvent } from "@/lib/stream";
import { explorerTx } from "@/lib/config";
import { Dot } from "./ui";

/** One human-readable line for an indexed protocol event. */
export function ActivityLine({ e, compact }: { e: ActivityEvent; compact?: boolean }) {
  const d = e.data;
  const who = e.owner ? (
    <Link href={`/profile/${e.owner}`} className="font-mono text-fg-2 hover:text-cyan">
      {shortKey(e.owner)}
    </Link>
  ) : null;
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
          {who} claimed <b className="font-medium text-flare">{formatTunnel(BigInt(d.tokens))}</b> $TUNNEL
        </>
      );
      break;
    case "CycleFinalized": {
      const s = (d.successes as string[]).reduce((a, b) => a + Number(b), 0);
      dot = "#00D9FF";
      text = (
        <>
          Cycle <Link href={`/history/cycle/${e.cycleId}`} className="text-fg-2 hover:text-cyan">{e.cycleId}</Link> settled ·{" "}
          {Number(d.outcome) === 4 ? "no participants" : Number(d.outcome) === 3 ? "void" : <><b className="font-medium text-cyan">{s}</b> tunneled</>}
        </>
      );
      break;
    }
    case "CycleOpened":
      dot = "#2864FF";
      text = <>Cycle {e.cycleId} opened · budget {formatTunnel(BigInt(d.emission_budget), 0)} $TUNNEL</>;
      break;
    case "CycleClosed":
      dot = "#F0A64B";
      text = <>Cycle {e.cycleId} closed · {d.participants} wallets · seed fixed</>;
      break;
    case "RandomnessRevealed":
      dot = "#885BFF";
      text = <>Cycle {e.cycleId} randomness revealed (ORAO VRF)</>;
      break;
    case "PositionSettled":
      dot = "#2864FF";
      text = <>{who} settled in cycle {e.cycleId}</>;
      break;
    case "CycleVoided":
      dot = "#FF6B7D";
      text = <>Cycle {e.cycleId} voided · randomness timeout</>;
      break;
  }
  return (
    <div className="flex items-center gap-3 text-[13px] text-muted">
      <Dot color={dot} />
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {!compact && (
        <a href={explorerTx(e.signature)} target="_blank" rel="noreferrer" className="shrink-0 font-mono text-[10.5px] text-faint hover:text-cyan">
          {e.blockTime ? new Date(e.blockTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "tx"}
        </a>
      )}
    </div>
  );
}
