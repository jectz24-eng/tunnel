"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { TunnelInstructions, computePayout, formatTunnel, type CycleAccount, type PositionAccount } from "@tunnel/sdk";
import { useMemo } from "react";
import { useCyclesById, useOwnerPositions, useProtocol } from "@/lib/chain";
import { appConfig, explorerTx } from "@/lib/config";
import { play } from "@/lib/sound";
import { useSendTx } from "@/lib/tx";
import { Badge, Button, Empty } from "../ui";

const ix = new TunnelInstructions(appConfig.programId);

function payoutOf(c: CycleAccount | undefined, p: PositionAccount): bigint | null {
  if (!c) return null;
  if (c.status === "void") return 0n;
  if (c.status !== "settled" || !p.settled) return null;
  return computePayout({ outcome: c.outcome, totalNominal: c.totalNominal, emissionBudget: c.emissionBudget, positionNominal: p.nominalReward });
}

/**
 * Claims, read from chain. Claiming pays the settled reward (if any) and
 * closes the position account, returning its deposit. Nothing expires.
 */
export function ClaimsPanel({ onReplay }: { onReplay?: (cycleId: bigint) => void }) {
  const { publicKey } = useWallet();
  const positions = useOwnerPositions();
  const protocol = useProtocol();
  const ids = useMemo(() => (positions.data ?? []).map((p) => p.cycleId), [positions.data]);
  const cycles = useCyclesById(ids);
  const { send, state } = useSendTx();

  const rows = (positions.data ?? []).map((p) => {
    const c = cycles.data?.get(p.cycleId.toString());
    return { p, c, payout: payoutOf(c, p) };
  });
  const claimable = rows.filter((r) => r.payout != null);
  const total = claimable.reduce((s, r) => s + (r.payout ?? 0n), 0n);

  const claim = async (list: typeof rows) => {
    const mint = protocol.data?.tunnelMint;
    if (!publicKey || !mint) return;
    // The token account is created once (idempotently); batch at most 4 claims per transaction.
    for (let i = 0; i < list.length; i += 4) {
      const batch = list.slice(i, i + 4);
      const ixs = batch.flatMap((r, j) => {
        const all = ix.claim({ owner: publicKey, cycleId: r.p.cycleId, tunnelMint: mint, expectsTokens: (r.payout ?? 0n) > 0n });
        return j > 0 && all.length === 2 ? [all[1]] : all;
      });
      const sig = await send(ixs);
      if (!sig) return;
      play("confirm");
    }
  };

  if (!publicKey) return <Empty title="Connect a wallet to see your claims">Rewards and refundable deposits from settled cycles appear here.</Empty>;
  if (positions.loading && !positions.data) return <Empty title="Reading your positions from chain…" />;

  const banner =
    state.phase === "confirmed" && state.signature ? (
      <div className="border-b border-line-soft px-5 py-2.5 text-xs text-cyan">
        Claimed ·{" "}
        <a className="underline" href={explorerTx(state.signature)} target="_blank" rel="noreferrer">
          view transaction
        </a>
      </div>
    ) : state.phase === "failed" ? (
      <div className="border-b border-red/20 bg-red/[0.06] px-5 py-2.5 text-xs text-red">{state.error}</div>
    ) : null;

  if (!rows.length)
    return (
      <>
        {banner}
        <Empty title="Nothing to claim">You have no open positions. Deploy particles in the current cycle to start an experiment.</Empty>
      </>
    );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-4">
        <div>
          <div className="label">Claimable now</div>
          <div className="mt-1 font-mono text-xl tabular">
            {formatTunnel(total)} <span className="text-sm text-muted">$TUNNEL</span>
          </div>
        </div>
        <Button variant="energy" size="sm" disabled={!claimable.length || ["signing", "sending", "confirming"].includes(state.phase)} onClick={() => claim(claimable)}>
          {state.phase === "signing" ? "Approve in wallet…" : state.phase === "confirming" || state.phase === "sending" ? "Confirming…" : `Claim all (${claimable.length})`}
        </Button>
      </div>
      {banner}
      <ul className="divide-y divide-line-soft">
        {rows.map(({ p, c, payout }) => {
          const tunneled = p.successes.flat().reduce((a, b) => a + b, 0);
          const total = p.particles.flat().reduce((a, b) => a + b, 0);
          const status = !c ? "loading" : c.status === "void" ? "void" : p.settled && c.status === "settled" ? "settled" : c.status === "open" ? "in cycle" : "settling";
          return (
            <li key={p.cycleId.toString()} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="w-16 font-mono text-xs text-fg-2">C{p.cycleId.toString()}</span>
              <span className="font-mono text-xs text-muted">
                {p.settled ? `${tunneled}/${total} tunneled` : `${total} particles`}
              </span>
              <Badge tone={status === "settled" ? (tunneled ? "flare" : "amber") : status === "void" ? "red" : "neutral"}>{status}</Badge>
              <span className="ml-auto font-mono text-sm tabular">{payout != null ? `${formatTunnel(payout)}` : "—"}</span>
              {p.settled && onReplay && (
                <Button size="sm" variant="ghost" onClick={() => onReplay(p.cycleId)}>
                  Replay
                </Button>
              )}
              <Button size="sm" variant="secondary" disabled={payout == null} onClick={() => claim([{ p, c, payout }])}>
                {payout === 0n ? "Close" : "Claim"}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
