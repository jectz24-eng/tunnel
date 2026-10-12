"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { formatSol, formatTunnel, shortKey } from "@tunnel/sdk";
import { useState } from "react";
import { useWalletAuth } from "@/components/WalletAuth";
import { Badge, Button, Empty, Panel, PanelHeader } from "@/components/ui";
import { explorerAddress, explorerTx } from "@/lib/config";
import { refreshMatching, usePoll } from "@/lib/poll";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Overview {
  casino: Record<string, any>;
  config: Record<string, any>;
  totals: Record<string, any>;
  failedActions: { id: string; kind: string; cycleId: string | null; error: string | null; createdAt: string }[];
  statusCounts: { status: string; count: number }[];
  stuck: { id: string; status: string; closedAt: string | null }[];
  unclaimed: { positions: number; tokens: string };
  payoutQueue: { id: string; wallet: string; amount: string; status: string; attempts: number; txSignature: string | null; error: string | null; createdAt: string }[];
  failedPayouts: { id: string; wallet: string; amount: string; error: string | null; createdAt: string }[];
  recentEvents: { id: string; name: string; wallet: string | null; createdAt: string }[];
}

/**
 * Operations console. Requires a Sign-In With Solana session whose wallet is
 * listed in ADMIN_WALLETS (enforced server-side on every request).
 */
export function AdminView() {
  const { publicKey } = useWallet();
  const auth = useWalletAuth();
  const overview = usePoll<{ status: number; body: { available?: boolean; data?: Overview; error?: string } }>(
    publicKey && auth.status === "verified" ? "admin:overview" : null,
    async () => {
      const r = await fetch("/api/admin", { cache: "no-store" });
      return { status: r.status, body: await r.json() };
    },
    8_000,
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [minBet, setMinBet] = useState("");
  const [maxBet, setMaxBet] = useState("");
  const [maxWin, setMaxWin] = useState("");

  const act = async (body: Record<string, unknown>, label: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? { ok: true, text: `${label}: done` } : { ok: false, text: j.error ?? `HTTP ${r.status}` });
      refreshMatching("admin:");
      refreshMatching("state");
    } finally {
      setBusy(false);
    }
  };

  if (!publicKey) return <Empty title="Connect an admin wallet">The operations console is only available to TUNNEL operators.</Empty>;
  if (auth.status !== "verified")
    return (
      <Empty title="Verify the admin wallet">
        <Button className="mt-3" variant="primary" onClick={() => void auth.signIn()}>
          {auth.status === "signing" ? "Sign in your wallet…" : "Sign the login message"}
        </Button>
      </Empty>
    );
  if (overview.data && overview.data.status !== 200) return <Empty title="Access denied">{overview.data.body.error ?? `HTTP ${overview.data.status}`}</Empty>;
  const o = overview.data?.body?.data;
  if (!o) return <Empty title={overview.data?.body.available === false ? "Database unavailable" : "Loading operations data…"} />;
  const c = o.config;
  const k = o.casino;
  const tok = (v: unknown) => (v == null ? "—" : formatTunnel(BigInt(v as string), 0));

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid min-w-0 gap-5">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-4">
          {[
            ["Accelerator", k.bettingOpen ? "live" : "PAUSED"],
            ["Engine", c.engineOnline ? "online" : "OFFLINE"],
            ["Vault $TUNNEL", tok(c.rewardWalletTokens)],
            ["Vault SOL (fees)", c.rewardWalletLamports != null ? formatSol(BigInt(c.rewardWalletLamports), 4) : "—"],
            ["Owed to players", tok(k.playerBalances)],
            ["Free bankroll", tok(k.freeBankroll)],
            ["Players · shots", `${k.players} · ${Number(k.bets).toLocaleString()}`],
            ["Wagered", tok(k.wagered)],
            ["Paid back to players", tok(k.returned)],
            ["Net to vault", tok(BigInt(k.wagered) - BigInt(k.returned))],
            ["Deposited · withdrawn", `${tok(k.deposited)} · ${tok(k.withdrawn)}`],
            ["Withdrawal queue", String(o.payoutQueue.length)],
          ].map(([key, v]) => (
            <div key={key} className="bg-panel px-5 py-4">
              <dt className="label">{key}</dt>
              <dd className={`mt-1.5 font-mono text-[15px] tabular ${v === "OFFLINE" || v === "PAUSED" ? "text-amber" : ""}`}>{v}</dd>
            </div>
          ))}
        </dl>

        <Panel className="overflow-hidden">
          <PanelHeader title="Withdrawal queue" />
          {!o.payoutQueue.length ? (
            <Empty title="No withdrawals waiting" />
          ) : (
            <ul className="divide-y divide-line-soft font-mono text-xs">
              {o.payoutQueue.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                  <span className="text-faint">#{p.id}</span>
                  <a className="text-cyan hover:underline" href={explorerAddress(p.wallet)} target="_blank" rel="noreferrer">
                    {shortKey(p.wallet)}
                  </a>
                  <span>{formatTunnel(BigInt(p.amount))}</span>
                  <Badge tone={p.status === "sending" ? "cyan" : "neutral"}>{p.status}</Badge>
                  <span className="text-faint">×{p.attempts}</span>
                  {p.error && <span className="min-w-0 flex-1 truncate text-amber">{p.error}</span>}
                  {p.txSignature && (
                    <a className="ml-auto text-cyan hover:underline" href={explorerTx(p.txSignature)} target="_blank" rel="noreferrer">
                      {p.txSignature.slice(0, 10)}…
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Failed withdrawals (returned to balance)" />
          {!o.failedPayouts.length ? (
            <Empty title="None" />
          ) : (
            <ul className="divide-y divide-line-soft font-mono text-xs">
              {o.failedPayouts.map((p) => (
                <li key={p.id} className="flex flex-wrap gap-3 px-5 py-2.5">
                  <span className="text-faint">{new Date(p.createdAt).toLocaleString()}</span>
                  <span>{shortKey(p.wallet)}</span>
                  <span>{formatTunnel(BigInt(p.amount))}</span>
                  <span className="min-w-0 flex-1 truncate text-red">{p.error}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Audit log" />
          {!o.recentEvents.length ? (
            <Empty title="No admin events yet" />
          ) : (
            <ul className="divide-y divide-line-soft font-mono text-xs">
              {o.recentEvents.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
                  <span className="text-faint">{new Date(e.createdAt).toLocaleString()}</span>
                  <span>{e.name}</span>
                  {e.wallet && <span className="text-muted">{e.wallet.length > 20 ? shortKey(e.wallet) : e.wallet}</span>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid h-fit gap-5">
        <Panel brackets>
          <PanelHeader title="Controls" right={<Badge tone="amber">logged</Badge>} />
          <div className="space-y-5 p-5 text-sm">
            <div>
              <div className="label mb-2">Accelerator</div>
              <Button variant={k.bettingOpen ? "danger" : "primary"} disabled={busy} onClick={() => act({ action: "betting", open: !k.bettingOpen }, k.bettingOpen ? "Pause" : "Open")}>
                {k.bettingOpen ? "Pause the accelerator" : "Open the accelerator"}
              </Button>
              <p className="mt-2 text-[11px] text-faint">Pausing stops new shots. Deposits and withdrawals keep working.</p>
            </div>
            <div>
              <div className="label mb-2">Table limits</div>
              <div className="grid grid-cols-3 gap-2">
                <input value={minBet} onChange={(e) => setMinBet(e.target.value)} placeholder={`min ${tok(k.minBet)}`} className="h-9 rounded-lg border border-line bg-bg-2 px-2 font-mono text-xs" />
                <input value={maxBet} onChange={(e) => setMaxBet(e.target.value)} placeholder={`max ${tok(k.maxBet)}`} className="h-9 rounded-lg border border-line bg-bg-2 px-2 font-mono text-xs" />
                <input value={maxWin} onChange={(e) => setMaxWin(e.target.value)} placeholder={`max win ${k.maxWinBps / 100}%`} className="h-9 rounded-lg border border-line bg-bg-2 px-2 font-mono text-xs" />
              </div>
              <Button
                size="sm"
                className="mt-2"
                disabled={busy}
                onClick={() =>
                  act(
                    {
                      action: "betLimits",
                      minBet: minBet || String(BigInt(k.minBet) / 1_000_000n),
                      maxBet: maxBet || String(BigInt(k.maxBet) / 1_000_000n),
                      maxWinBps: maxWin ? Math.round(Number(maxWin) * 100) : k.maxWinBps,
                    },
                    "Limits",
                  )
                }
              >
                Update limits
              </Button>
              <p className="mt-2 text-[11px] leading-relaxed text-faint">Bets per particle in whole $TUNNEL. Max win is the share (%) of the free bankroll one shot may win. Every change is logged.</p>
            </div>
            {msg && <div className={`rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-line text-muted" : "border-red/30 text-red"}`}>{msg.text}</div>}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Addresses" />
          <dl className="space-y-2 p-5 font-mono text-[11px]">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">vault</dt>
              <dd className="break-all text-right">{c.rewardWallet ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">$TUNNEL mint</dt>
              <dd className="break-all text-right">{c.tunnelMint ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">signed in</dt>
              <dd className="break-all text-right">{publicKey.toBase58()}</dd>
            </div>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
