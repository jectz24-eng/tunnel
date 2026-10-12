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
  const [dur, setDur] = useState("");
  const [emission, setEmission] = useState("");

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

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid min-w-0 gap-5">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-4">
          {[
            ["Mining", c.paused ? "PAUSED" : "running"],
            ["Engine", c.engineOnline ? "online" : "OFFLINE"],
            ["Reserve unallocated", formatTunnel(BigInt(c.reserveAvailable), 0)],
            ["Reward wallet $TUNNEL", c.rewardWalletTokens != null ? formatTunnel(BigInt(c.rewardWalletTokens), 0) : "—"],
            ["Reward wallet SOL", c.rewardWalletLamports != null ? formatSol(BigInt(c.rewardWalletLamports), 4) : "—"],
            ["Unclaimed owed", `${formatTunnel(BigInt(o.unclaimed.tokens))} · ${o.unclaimed.positions} pos.`],
            ["Payout queue", String(o.payoutQueue.length)],
            ["Stuck cycles", String(o.stuck.length)],
          ].map(([k, v]) => (
            <div key={k} className="bg-panel px-5 py-4">
              <dt className="label">{k}</dt>
              <dd className={`mt-1.5 font-mono text-[15px] tabular ${v === "OFFLINE" || v === "PAUSED" ? "text-amber" : ""}`}>{v}</dd>
            </div>
          ))}
        </dl>

        <Panel className="overflow-hidden">
          <PanelHeader title="Cycles by status" />
          <div className="flex flex-wrap gap-2 p-5">
            {o.statusCounts.map((s) => (
              <Badge key={s.status} tone={s.status === "void" ? "red" : s.status === "settled" ? "flare" : "neutral"}>
                {s.status} · {s.count}
              </Badge>
            ))}
          </div>
          {o.stuck.length > 0 && (
            <div className="border-t border-amber/20 bg-amber/[0.04] px-5 py-3 text-sm text-amber">
              Closed for more than 15 min without settlement: {o.stuck.map((x) => `#${x.id}`).join(", ")}. Check the engine and its RPC; after ENGINE_VOID_AFTER_MS the engine voids them.
            </div>
          )}
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Payout queue" />
          {!o.payoutQueue.length ? (
            <Empty title="No payouts waiting" />
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
          <PanelHeader title="Failed payouts (returned to claimable)" />
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
              <div className="label mb-2">Mining</div>
              <Button variant={c.paused ? "primary" : "danger"} disabled={busy} onClick={() => act({ action: c.paused ? "resume" : "pause" }, c.paused ? "Resume" : "Pause")}>
                {c.paused ? "Resume mining" : "Pause mining"}
              </Button>
              <p className="mt-2 text-[11px] text-faint">Pausing stops new cycles and deployments. Settlement and payouts continue.</p>
            </div>
            <div>
              <div className="label mb-2">Future cycles</div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input value={dur} onChange={(e) => setDur(e.target.value)} placeholder={`cycle seconds (now ${c.params.cycleDurationSecs})`} className="h-9 rounded-lg border border-line bg-bg-2 px-2 font-mono text-xs" />
                <Button size="sm" disabled={busy || !/^\d+$/.test(dur)} onClick={() => act({ action: "cycleDuration", seconds: Number(dur) }, "Cycle length")}>
                  Update
                </Button>
                <input
                  value={emission}
                  onChange={(e) => setEmission(e.target.value)}
                  placeholder={`$TUNNEL per cycle (now ${formatTunnel(BigInt(c.params.initialEmissionPerCycle), 0)})`}
                  className="h-9 rounded-lg border border-line bg-bg-2 px-2 font-mono text-xs"
                />
                <Button size="sm" disabled={busy || !/^\d+$/.test(emission)} onClick={() => act({ action: "emission", tokensPerCycle: emission }, "Emission")}>
                  Update
                </Button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-faint">Applies to cycles opened afterwards. Every change is recorded in the audit log with your wallet.</p>
            </div>
            {msg && <div className={`rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-line text-muted" : "border-red/30 text-red"}`}>{msg.text}</div>}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Addresses" />
          <dl className="space-y-2 p-5 font-mono text-[11px]">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">reward wallet</dt>
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
