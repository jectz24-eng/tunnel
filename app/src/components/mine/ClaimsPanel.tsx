"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { BARRIER_META, TunnelInstructions, computePayout, formatSol, formatTunnel, type PositionAccount, type RoundAccount } from "@tunnel/sdk";
import Link from "next/link";
import { useMemo } from "react";
import { useOwnerPositions, useProtocol, useRoundsById } from "@/lib/chain";
import { appConfig, explorerTx } from "@/lib/config";
import { displayStatus, outcomeLabel, statusTone } from "@/lib/round";
import { useSendTx } from "@/lib/tx";
import { Badge, Button, Empty } from "../ui";

const CLAIMS_PER_TX = 3;

export interface ClaimRow {
  position: PositionAccount;
  round: RoundAccount | undefined;
  payout: { lamports: bigint; tokens: bigint } | null;
}

/** Joins the wallet's open positions with their rounds and computes payouts with the program's own formula. */
export function useClaimRows() {
  const positions = useOwnerPositions();
  const ids = useMemo(() => (positions.data ?? []).map((p) => p.roundId), [positions.data]);
  const rounds = useRoundsById(ids);
  const rows: ClaimRow[] = (positions.data ?? []).map((p) => {
    const r = rounds.data?.get(p.roundId.toString());
    const claimable = r && (r.status === "settled" || r.status === "failed") && r.outcome !== "empty" && (p.settled || r.status === "failed");
    return {
      position: p,
      round: r,
      payout: claimable
        ? computePayout({
            outcome: r.outcome,
            distributableLamports: r.distributableLamports,
            totalLamports: r.totalLamports,
            totalSuccessWeight: r.totalSuccessWeight,
            emissionBudget: r.emissionBudget,
            positionLamports: p.lamports,
            positionSuccessWeight: p.successWeight,
          })
        : null,
    };
  });
  return { rows, loading: positions.loading || rounds.loading, error: positions.error };
}

export function ClaimsPanel({ now }: { now: number }) {
  const { publicKey } = useWallet();
  const protocol = useProtocol();
  const { rows, loading, error } = useClaimRows();
  const { state, send } = useSendTx();
  const claimable = rows.filter((r) => r.payout);
  const totalSol = claimable.reduce((a, r) => a + r.payout!.lamports, 0n);
  const totalTok = claimable.reduce((a, r) => a + r.payout!.tokens, 0n);

  const claim = async (targets: ClaimRow[]) => {
    if (!publicKey || !protocol.data) return;
    const ix = new TunnelInstructions(appConfig.programId);
    for (let i = 0; i < targets.length; i += CLAIMS_PER_TX) {
      const batch = targets.slice(i, i + CLAIMS_PER_TX);
      const sig = await send(batch.map((r) => ix.claim({ owner: publicKey, roundId: r.position.roundId, tunnelMint: protocol.data!.tunnelMint })));
      if (!sig) break;
    }
  };

  if (!publicKey) return <Empty title="Connect a wallet">Your open positions, outcomes and claimable rewards appear here.</Empty>;
  if (error) return <Empty title="Couldn't load positions">The RPC endpoint did not respond. Your funds are unaffected; try again shortly.</Empty>;
  if (!loading && rows.length === 0)
    return <Empty title="No open positions">Positions appear here after you deploy particles, and disappear once claimed (claim history is on your dashboard).</Empty>;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
        <div className="font-mono text-[12px] text-muted">
          claimable <span className="text-fg">{formatSol(totalSol)} SOL</span> · <span className="text-fg">{formatTunnel(totalTok)} $TUNNEL</span>
        </div>
        <div className="flex items-center gap-3">
          {state.phase === "confirmed" && state.signature && (
            <a href={explorerTx(state.signature)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-green hover:underline">
              claimed · view tx
            </a>
          )}
          {state.phase === "failed" && <span className="max-w-xs truncate text-[11.5px] text-red" title={state.error}>{state.error}</span>}
          <Button size="sm" variant="primary" disabled={claimable.length === 0 || state.phase === "signing" || state.phase === "confirming"} onClick={() => void claim(claimable)}>
            {state.phase === "signing" ? "Approve in wallet…" : state.phase === "confirming" ? "Confirming…" : `Claim all (${claimable.length})`}
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[12.5px]">
          <thead>
            <tr className="text-left">
              {["Round", "Status", "Particles", "Tunnelled", "Committed", "SOL claimable", "$TUNNEL", ""].map((h) => (
                <th key={h} className="label px-4 py-2.5 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono tabular">
            {rows.map((r) => {
              const st = r.round ? displayStatus(r.round, now) : null;
              return (
                <tr key={r.position.address.toBase58()} className="border-t border-line-soft">
                  <td className="px-4 py-2.5">
                    <Link href={`/rounds/${r.position.roundId}`} className="text-fg hover:text-cyan">
                      #{r.position.roundId.toLocaleString()}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{st && <Badge tone={statusTone[st]}>{st === "SETTLED" ? outcomeLabel[r.round!.outcome] : st}</Badge>}</td>
                  <td className="px-4 py-2.5">
                    {r.position.particles.map((n, i) =>
                      n ? (
                        <span key={i} className="mr-2" style={{ color: BARRIER_META[i].color }}>
                          {BARRIER_META[i].numeral}:{n}
                        </span>
                      ) : null,
                    )}
                  </td>
                  <td className="px-4 py-2.5">{r.position.settled ? <span className="text-green">{r.position.successes.reduce((a, b) => a + b, 0)}</span> : <span className="text-faint">pending</span>}</td>
                  <td className="px-4 py-2.5 text-fg-2">{formatSol(r.position.lamports)}</td>
                  <td className="px-4 py-2.5">{r.payout ? formatSol(r.payout.lamports) : <span className="text-faint">—</span>}</td>
                  <td className="px-4 py-2.5">{r.payout ? formatTunnel(r.payout.tokens) : <span className="text-faint">—</span>}</td>
                  <td className="px-4 py-2.5 text-right">
                    {r.payout && (
                      <Button size="sm" onClick={() => void claim([r])} disabled={state.phase === "signing" || state.phase === "confirming"}>
                        Claim
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line-soft px-4 py-2.5 text-[11px] text-faint">
        Claims never expire. Each claim pays SOL and $TUNNEL together, closes the position, and refunds its rent. Amounts are computed with the program&apos;s settlement formula and verified onchain when you claim.
      </p>
    </div>
  );
}
