"use client";

import { VOLATILITY, formatMultiplier, formatTunnel, shortKey } from "@tunnel/sdk";
import Link from "next/link";
import { SolscanLink } from "@/components/SolscanLink";
import { useState } from "react";
import { getJson } from "@/lib/api";
import type { BetView, GameEngine } from "@/lib/game";
import { usePoll } from "@/lib/poll";
import { Badge, Button, Empty } from "../ui";

/** Tiny per-particle result strip. */
export function Hits({ hits, max = 20 }: { hits: boolean[]; max?: number }) {
  return (
    <span className="flex flex-wrap gap-0.5" aria-label={`${hits.filter(Boolean).length} of ${hits.length} tunneled`}>
      {hits.slice(0, max).map((h, i) => (
        <span key={i} className="size-2 rounded-[2px]" style={{ background: h ? "#EAFBFF" : "rgba(240,166,75,0.35)", boxShadow: h ? "0 0 6px #00D9FF" : undefined }} />
      ))}
    </span>
  );
}

export function BetRow({ b, unit, href }: { b: BetView; unit: string; href?: string }) {
  const v = VOLATILITY[b.volatility];
  const net = b.payout - b.stake;
  const inner = (
    <>
      <span className="w-14 font-mono text-[11px]" style={{ color: v.color }}>
        {v.short}
      </span>
      <Hits hits={b.hits} />
      <span className="ml-auto text-right font-mono text-[12px] tabular">
        <span className="text-muted">{formatTunnel(b.stake)} →</span>{" "}
        <span className={net > 0n ? "text-flare" : net < 0n ? "text-fg-2" : "text-muted"}>{formatTunnel(b.payout)}</span>
        <span className="ml-1 text-[10px] text-faint">{unit}</span>
      </span>
    </>
  );
  return href ? (
    <Link href={href} title="Verify this shot" className="flex items-center gap-3 px-5 py-2.5 hover:bg-panel-2/60">
      {inner}
      <span className="font-mono text-[10px] text-faint">verify →</span>
    </Link>
  ) : (
    <div className="flex items-center gap-3 px-5 py-2.5">{inner}</div>
  );
}

/** The player's own recent bets. */
export function HistoryPanel({ game, unit }: { game: GameEngine; unit: string }) {
  if (game.status === "connect" || game.status === "signin") return <Empty title="Your bets appear here">Connect and sign in to start firing.</Empty>;
  if (!game.history.length) return <Empty title="No shots fired yet">Pick a barrier, set your energy and fire.</Empty>;
  return (
    <div className="max-h-[420px] divide-y divide-line-soft overflow-y-auto">
      {game.history.map((b) => (
        <BetRow key={b.id} b={b} unit={unit} href={game.mode === "live" ? `/history/bet/${b.id}` : undefined} />
      ))}
    </div>
  );
}

/** Provably fair seeds: hash committed in advance, revealed on rotation. */
export function FairnessPanel({ game }: { game: GameEngine }) {
  const [client, setClient] = useState("");
  const [revealed, setRevealed] = useState<{ seed: string; hash: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = game.seed;
  if (!s) return <Empty title="Seeds appear once you are signed in" />;
  const rotate = async () => {
    setBusy(true);
    setErr(null);
    const r = await game.rotate(client.trim() || undefined);
    setBusy(false);
    if (r.ok) {
      setRevealed({ seed: r.revealedSeed, hash: r.revealedHash });
      setClient("");
    } else setErr(r.error);
  };
  return (
    <div className="space-y-3 p-5 font-mono text-[11px]">
      <div>
        <div className="label">Server seed hash (locked in before you bet)</div>
        <div className="mt-1 break-all text-fg-2">{s.serverSeedHash}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="label">Client seed</div>
          <div className="mt-1 break-all text-fg-2">{s.clientSeed}</div>
        </div>
        <div>
          <div className="label">Next nonce</div>
          <div className="mt-1 text-fg-2">{s.nonce}</div>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <input
          value={client}
          onChange={(e) => setClient(e.target.value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64))}
          placeholder="new client seed (optional)"
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-bg-2 px-2 text-[11px]"
        />
        <Button size="sm" variant="secondary" disabled={busy} onClick={rotate}>
          Rotate &amp; reveal
        </Button>
      </div>
      {revealed && (
        <div className="rounded-md border border-cyan/25 bg-cyan/[0.05] p-2.5 text-cyan">
          Revealed server seed <span className="break-all text-fg-2">{revealed.seed}</span>. Check: sha256(seed) = {revealed.hash.slice(0, 16)}…, the hash you saw before betting.
          {game.mode === "live" && <> Every bet made with it can now be verified from its page in History.</>}
        </div>
      )}
      {err && <div className="text-red">{err}</div>}
      <p className="font-sans text-[11px] leading-relaxed text-faint">
        Each particle = HMAC-SHA256(server seed, &quot;TUNNEL/bet/v1:client seed:nonce:particle&quot;). The server can&apos;t change a seed after you&apos;ve seen its hash, and you control the
        client seed.
      </p>
    </div>
  );
}

interface FeedRow {
  id: string;
  wallet: string;
  volatility: number;
  stake: string;
  payout: string;
  wins: number;
  count: number;
  multiplierBps: number;
  createdAt: string;
}

/** Everyone's latest bets (real data from the server). */
export function LiveBets({ unit }: { unit: string }) {
  const feed = usePoll("casino:feed", () => getJson<{ rows: FeedRow[] }>("/api/casino/bets?limit=15"), 3_000);
  const rows = feed.data?.data?.rows ?? [];
  if (feed.data && !feed.data.available) return <Empty title="Live feed offline" />;
  if (!rows.length) return <Empty title={feed.loading ? "Loading…" : "Be the first to fire"} />;
  return (
    <ul className="divide-y divide-line-soft">
      {rows.map((r) => {
        const v = VOLATILITY[r.volatility];
        const net = BigInt(r.payout) - BigInt(r.stake);
        return (
          <li key={r.id} className="flex items-center gap-2 pl-5 text-[12px] hover:bg-panel-2/60">
            <span className="w-24 truncate font-mono text-fg-2">{shortKey(r.wallet)}</span>
            <SolscanLink address={r.wallet} />
            <Link href={`/history/bet/${r.id}`} title="Verify this shot" className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-1 pr-5">

              <span className="w-14 font-mono text-[11px]" style={{ color: v.color }}>
                {v.short}
              </span>
              <span className="font-mono text-muted">
                {r.wins}/{r.count}
              </span>
              <span className={`ml-auto font-mono tabular ${net > 0n ? "text-flare" : "text-muted"}`}>
                {net > 0n ? "+" : ""}
                {formatTunnel(net)} <span className="text-[10px] text-faint">{unit}</span>
              </span>
              <span className="font-mono text-[10px] text-faint">verify →</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The result of the last shot, shown above the chamber controls. */
export function LastResult({ bet, unit }: { bet: BetView; unit: string }) {
  const net = bet.payout - bet.stake;
  const v = VOLATILITY[bet.volatility];
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
      <Badge tone={bet.wins > 0 ? "flare" : "amber"}>{bet.wins > 0 ? "Tunneled" : "Reflected"}</Badge>
      <div className="font-mono text-[13px]">
        <span className="text-muted">tunneled</span> {bet.wins}/{bet.count}
      </div>
      <div className="font-mono text-[13px]">
        <span className="text-muted">paid</span> {formatTunnel(bet.payout)} {unit}
      </div>
      <div className={`ml-auto font-mono text-[18px] tabular ${net > 0n ? "text-flare glow-text" : "text-fg-2"}`}>
        {net > 0n ? "+" : ""}
        {formatTunnel(net)}
      </div>
      <div className="w-full font-mono text-[10.5px] text-faint">
        {v.short} · {formatMultiplier(v.multiplierBps)} · nonce {bet.nonce}
      </div>
    </div>
  );
}
