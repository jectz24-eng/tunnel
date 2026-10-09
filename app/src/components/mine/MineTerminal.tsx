"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { DEFAULT_PARAMS, type RoundAccount } from "@tunnel/sdk";
import { useMemo, useState } from "react";
import { TunnelingChamber, type ChamberResolution } from "../chamber/TunnelingChamber";
import { Badge, Panel, cx } from "../ui";
import { splitRounds, useChainClock, useOwnerPositions, useRounds } from "@/lib/chain";
import { displayStatus, formatCountdown, statusTone, useVerifiedOutcomes, type DisplayStatus } from "@/lib/round";
import { ActivityFeed } from "./ActivityFeed";
import { AllocationPanel } from "./AllocationPanel";
import { ClaimsPanel } from "./ClaimsPanel";
import { RecentRounds } from "./RecentRounds";
import { RoundPanel } from "./RoundPanel";

const RESOLUTION_WINDOW_S = 45;

export function MineTerminal() {
  const { now } = useChainClock(250);
  const rounds = useRounds(12);
  const { publicKey } = useWallet();
  const positions = useOwnerPositions();
  const protocol = rounds.protocol.data;
  const { current, upcoming, recent } = splitRounds(rounds.data, now);
  const [tab, setTab] = useState<"rounds" | "positions">("rounds");

  // ---- chamber focus: what the visualization shows right now
  const resolving = recent.find(
    (r) => r.participants > 0 && (["closed", "awaitingRandomness", "resolving"].includes(r.status) || (r.status === "open" && now >= r.closeTs)),
  );
  const justSettled = recent.find((r) => (r.status === "settled" || r.status === "failed") && r.participants > 0 && now - r.settledTs < RESOLUTION_WINDOW_S);
  const verified = useVerifiedOutcomes(!resolving && justSettled?.status === "settled" ? justSettled : null);

  const focus: RoundAccount | null = resolving ?? (justSettled && verified.data?.verified ? justSettled : null) ?? current ?? upcoming ?? recent[0] ?? null;
  const focusStatus = focus ? displayStatus(focus, now) : null;
  const queued = focus && (focusStatus === "OPEN" || focusStatus === "CLOSED" || focusStatus === "AWAITING RANDOMNESS" || focusStatus === "RESOLVING") ? focus.particles.map(Number) : [0, 0, 0];

  const resolution: ChamberResolution | null = useMemo(
    () => (justSettled && verified.data?.verified && verified.data.outcomes ? { key: justSettled.id.toString(), outcomes: verified.data.outcomes } : null),
    [justSettled, verified.data],
  );

  const roundForDeposits = current;
  const myPosition = useMemo(
    () => (roundForDeposits && positions.data ? (positions.data.find((p) => p.roundId === roundForDeposits.id) ?? null) : null),
    [roundForDeposits, positions.data],
  );

  const headerRound = current ?? upcoming ?? recent[0] ?? null;
  const headerStatus: DisplayStatus | null = headerRound ? displayStatus(headerRound, now) : null;
  const countdownTarget = headerRound ? (headerStatus === "UPCOMING" ? headerRound.openTs : headerRound.closeTs) : null;
  const remaining = countdownTarget != null ? countdownTarget - now : null;
  const progress = headerRound && headerStatus === "OPEN" ? Math.min(1, Math.max(0, (now - headerRound.openTs) / (headerRound.closeTs - headerRound.openTs))) : 0;

  const caption = focus ? (
    <span>
      ROUND {focus.id.toLocaleString()} · {focusStatus}
      {focus === justSettled && resolution ? " · replaying verified outcomes" : ""}
    </span>
  ) : null;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      {/* round header */}
      <Panel className="mb-4 overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
          <div>
            <div className="label">Round</div>
            <div className="mt-1 font-mono text-[22px] tabular">{headerRound ? `#${headerRound.id.toLocaleString()}` : "—"}</div>
          </div>
          <div>
            <div className="label">State</div>
            <div className="mt-1.5">{headerStatus ? <Badge tone={statusTone[headerStatus]}>{headerStatus}</Badge> : <Badge>{protocol === null ? "NOT DEPLOYED" : "WAITING"}</Badge>}</div>
          </div>
          <div>
            <div className="label">{headerStatus === "UPCOMING" ? "Opens in" : "Closes in"}</div>
            <div className={cx("mt-1 font-mono text-[22px] tabular", remaining != null && remaining < 10 && headerStatus === "OPEN" && "text-amber")}>
              {remaining != null && (headerStatus === "OPEN" || headerStatus === "UPCOMING") ? formatCountdown(remaining) : "—"}
            </div>
          </div>
          {upcoming && current && (
            <div className="hidden md:block">
              <div className="label">Next round</div>
              <div className="mt-1 font-mono text-[13px] text-muted">#{upcoming.id.toLocaleString()} queued</div>
            </div>
          )}
          <div className="ml-auto hidden max-w-xs text-right text-[11.5px] leading-relaxed text-muted lg:block">
            Deadlines follow the Solana cluster clock. Deposits are rejected onchain once a round&apos;s window ends.
          </div>
        </div>
        <div className="h-[2px] bg-bg-2">
          <div className="h-full bg-gradient-to-r from-cyan via-blue to-violet transition-[width] duration-300 ease-linear" style={{ width: `${progress * 100}%` }} />
        </div>
      </Panel>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_320px]">
        <Panel className="order-2 lg:order-1">
          <AllocationPanel round={roundForDeposits} position={myPosition} now={now} paused={!!protocol?.paused} deployed={protocol !== null && protocol !== undefined} />
        </Panel>

        <div className="order-1 flex min-w-0 flex-col gap-4 lg:order-2">
          <Panel className="relative overflow-hidden">
            <div className="grid-backdrop pointer-events-none absolute inset-0 opacity-50" />
            <TunnelingChamber
              mode="live"
              barriers={focus?.barriers ?? protocol?.params.barriers ?? DEFAULT_PARAMS.barriers}
              queued={queued}
              resolution={resolution}
              caption={caption}
              className="h-[300px] sm:h-[420px] xl:h-[520px]"
            />
          </Panel>
          {justSettled && verified.data && !verified.data.verified && (
            <div className="rounded-lg border border-red/30 bg-red/[0.06] px-4 py-2.5 text-xs text-red">
              Round {justSettled.id.toString()}: recomputed outcomes did not match recorded settlement. Animation suppressed; see the round&apos;s verification page.
            </div>
          )}
        </div>

        <Panel className="order-3 lg:col-span-2 xl:col-span-1">
          <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-2 xl:grid-cols-1">
            <RoundPanel round={current ?? upcoming} position={myPosition} />
            <ActivityFeed className="border-t border-line-soft lg:border-l lg:border-t-0 xl:border-l-0 xl:border-t" />
          </div>
        </Panel>
      </div>

      <Panel className="mt-4">
        <div className="flex items-center gap-1 border-b border-line-soft px-2">
          {(
            [
              ["rounds", "Recent rounds"],
              ["positions", publicKey ? "Your positions & rewards" : "Rewards"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cx("relative px-3 py-3 text-[13px] transition-colors", tab === k ? "text-fg" : "text-muted hover:text-fg")}
            >
              {label}
              {tab === k && <span className="absolute inset-x-3 -bottom-px h-px bg-cyan" />}
            </button>
          ))}
        </div>
        {tab === "rounds" ? <RecentRounds rounds={recent} now={now} /> : <ClaimsPanel now={now} />}
      </Panel>
    </div>
  );
}
