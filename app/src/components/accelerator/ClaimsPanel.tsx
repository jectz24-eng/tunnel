"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { claimMessage, formatTunnel } from "@tunnel/sdk";
import { useCycles, useWalletState } from "@/lib/chain";
import { explorerTx } from "@/lib/config";
import { play } from "@/lib/sound";
import { newNonce, useSignedRequest } from "@/lib/tx";
import { Badge, Button, Empty } from "../ui";

const PAYOUT_LABEL = { requested: "payout queued", sending: "sending", confirmed: "paid", failed: "retry claim" } as const;

/**
 * Rewards accrue on TUNNEL as cycles settle. Claiming signs a free message;
 * the TUNNEL engine then sends every unpaid reward to this wallet as real
 * $TUNNEL in one Solana transfer and pays the network fee itself.
 */
export function ClaimsPanel({ onReplay }: { onReplay?: (cycleId: bigint) => void }) {
  const { publicKey } = useWallet();
  const me = useWalletState();
  const cycles = useCycles();
  const { submit, state } = useSignedRequest<{ payout: { amount: string; cycles: number } }>();

  const claim = async () => {
    if (!publicKey) return;
    const ok = await submit("/api/claim", claimMessage({ wallet: publicKey.toBase58(), nonce: newNonce(), issuedAt: new Date().toISOString() }));
    if (ok) play("confirm");
  };

  if (!publicKey) return <Empty title="Connect a wallet to see your rewards">Rewards from settled cycles appear here and can be claimed as $TUNNEL.</Empty>;
  if (me.data === undefined) return <Empty title="Loading your positions…" />;
  if (me.data === null) return <Empty title="Rewards are temporarily unavailable">TUNNEL could not be reached. Your positions are safe; try again shortly.</Empty>;

  const { positions, claimable, payouts } = me.data;
  const inFlight = payouts.find((p) => p.status === "requested" || p.status === "sending");
  const lastPaid = payouts.find((p) => p.status === "confirmed");
  const busy = state.phase === "signing" || state.phase === "sending";
  const statusOf = (id: bigint) => cycles.data?.find((c) => c.id === id)?.status;

  const banner =
    state.phase === "failed" ? (
      <div className="border-b border-red/20 bg-red/[0.06] px-5 py-2.5 text-xs text-red">{state.error}</div>
    ) : inFlight ? (
      <div className="border-b border-line-soft px-5 py-2.5 text-xs text-cyan">
        Sending {formatTunnel(inFlight.amount)} $TUNNEL to your wallet…
        {inFlight.txSignature && (
          <>
            {" "}
            <a className="underline" href={explorerTx(inFlight.txSignature)} target="_blank" rel="noreferrer">
              view transaction
            </a>
          </>
        )}
      </div>
    ) : lastPaid?.txSignature && Date.now() - Date.parse(lastPaid.confirmedAt ?? lastPaid.createdAt) < 10 * 60_000 ? (
      <div className="border-b border-line-soft px-5 py-2.5 text-xs text-flare">
        Paid {formatTunnel(lastPaid.amount)} $TUNNEL ·{" "}
        <a className="underline" href={explorerTx(lastPaid.txSignature)} target="_blank" rel="noreferrer">
          view transaction
        </a>
      </div>
    ) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-4">
        <div>
          <div className="label">Claimable now</div>
          <div className="mt-1 font-mono text-xl tabular">
            {formatTunnel(claimable.amount)} <span className="text-sm text-muted">$TUNNEL</span>
          </div>
          <div className="mt-1 text-[11px] text-faint">Free to claim · TUNNEL pays the network fee</div>
        </div>
        <Button variant="energy" size="sm" disabled={claimable.amount === 0n || !!inFlight || busy} onClick={claim}>
          {state.phase === "signing" ? "Approve in wallet…" : state.phase === "sending" ? "Requesting…" : inFlight ? "Payout in progress" : `Claim${claimable.cycles > 1 ? ` all (${claimable.cycles})` : ""}`}
        </Button>
      </div>
      {banner}
      {!positions.length ? (
        <Empty title="No experiments yet">Deploy particles in the current cycle to start an experiment.</Empty>
      ) : (
        <ul className="divide-y divide-line-soft">
          {positions.map((p) => {
            const tunneled = p.successes.flat().reduce((a, b) => a + b, 0);
            const total = p.particles.flat().reduce((a, b) => a + b, 0);
            const cs = statusOf(p.cycleId);
            const status = cs === "void" ? "void" : p.settled ? "settled" : cs === "open" ? "in cycle" : "settling";
            return (
              <li key={p.cycleId.toString()} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="w-16 font-mono text-xs text-fg-2">C{p.cycleId.toString()}</span>
                <span className="font-mono text-xs text-muted">{p.settled ? `${tunneled}/${total} tunneled` : `${total} particles`}</span>
                <Badge tone={status === "settled" ? (tunneled ? "flare" : "amber") : status === "void" ? "red" : "neutral"}>{status}</Badge>
                {p.payoutStatus && <Badge tone={p.payoutStatus === "confirmed" ? "cyan" : p.payoutStatus === "failed" ? "red" : "neutral"}>{PAYOUT_LABEL[p.payoutStatus]}</Badge>}
                <span className="ml-auto font-mono text-sm tabular">{p.payout != null ? formatTunnel(p.payout) : "—"}</span>
                {p.settled && status !== "void" && onReplay && (
                  <Button size="sm" variant="ghost" onClick={() => onReplay(p.cycleId)}>
                    Replay
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
