"use client";

import { formatSol, formatTunnel, shortKey } from "@tunnel/sdk";
import { useState } from "react";
import { Badge, Button, Empty, Panel, PanelHeader } from "@/components/ui";
import { explorerAddress, explorerTx } from "@/lib/config";
import { refreshMatching, usePoll } from "@/lib/poll";
import { sealRewardWallet } from "@/lib/sealWallet";

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
  settings: {
    engineRpcUrl: string | null;
    publicRpcUrl: string | null;
    tunnelMint: string | null;
    sealPublicKey: string | null;
    rewardWalletSet: string | null;
    rewardWalletActive: string | null;
  };
}

const field = "h-9 w-full rounded-lg border border-line bg-bg-2 px-2 font-mono text-xs";

/**
 * Operations console. Requires the admin password; the server checks the
 * resulting HttpOnly session cookie on every request.
 */
export function AdminView() {
  const overview = usePoll<{ status: number; body: { available?: boolean; data?: Overview; error?: string } }>(
    "admin:overview",
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
  const [password, setPassword] = useState("");
  const [engineRpc, setEngineRpc] = useState("");
  const [publicRpc, setPublicRpc] = useState("");
  const [mint, setMint] = useState("");
  const [walletKey, setWalletKey] = useState("");

  const signIn = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setMsg({ ok: false, text: j.error ?? `HTTP ${r.status}` });
      setPassword("");
      refreshMatching("admin:");
    } finally {
      setBusy(false);
    }
  };
  const signOut = async () => {
    await fetch("/api/admin/login", { method: "DELETE" });
    refreshMatching("admin:");
  };

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

  if (overview.data?.status === 401)
    return (
      <div className="mx-auto max-w-sm px-4 py-16">
        <Panel brackets>
          <PanelHeader title="Admin sign-in" />
          <form
            className="space-y-3 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void signIn();
            }}
          >
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" aria-label="Admin password" className="h-10 w-full rounded-lg border border-line bg-bg-2 px-3 text-sm" />
            <Button type="submit" variant="primary" disabled={busy || !password}>
              {busy ? "Checking…" : "Sign in"}
            </Button>
            {msg && !msg.ok && <div className="text-xs text-red">{msg.text}</div>}
          </form>
        </Panel>
      </div>
    );
  if (overview.data && overview.data.status !== 200) return <Empty title="Access denied">{overview.data.body.error ?? `HTTP ${overview.data.status}`}</Empty>;
  const o = overview.data?.body?.data;
  if (!o) return <Empty title={overview.data?.body.available === false ? "Database unavailable" : "Loading operations data…"} />;
  const c = o.config;
  const k = o.casino;
  const st = o.settings;
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
              <div className="grid grid-cols-2 gap-2">
                <input value={minBet} onChange={(e) => setMinBet(e.target.value)} placeholder={`min ${tok(k.minBet)}`} className="h-9 rounded-lg border border-line bg-bg-2 px-2 font-mono text-xs" />
                <input value={maxBet} onChange={(e) => setMaxBet(e.target.value)} placeholder={`max ${tok(k.maxBet)}`} className="h-9 rounded-lg border border-line bg-bg-2 px-2 font-mono text-xs" />
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
                      maxWinBps: k.maxWinBps,
                    },
                    "Limits",
                  )
                }
              >
                Update limits
              </Button>
              <p className="mt-2 text-[11px] leading-relaxed text-faint">Bets per particle in whole $TUNNEL. Wins are not capped by the vault balance, so the max bet is the only size limit. Every change is logged.</p>
            </div>
            <div>
              <div className="label mb-2">Reset</div>
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={async () => {
                  const typed = window.prompt("This permanently deletes every shot (History) and zeroes the Leaderboard. Balances, deposits and withdrawals stay.\n\nType RESET to confirm.");
                  if (typed !== "RESET") return;
                  setBusy(true);
                  setMsg(null);
                  try {
                    const r = await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resetStats", confirm: typed }) });
                    const j = await r.json().catch(() => ({}));
                    setMsg(r.ok ? { ok: true, text: `Reset: deleted ${j.bets} shots, cleared stats for ${j.players} players` } : { ok: false, text: j.error ?? `HTTP ${r.status}` });
                    refreshMatching("admin:");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Reset history &amp; leaderboard
              </Button>
              <p className="mt-2 text-[11px] leading-relaxed text-faint">Deletes all shots and zeroes leaderboard stats. Balances, deposits and withdrawals are kept. Cannot be undone.</p>
            </div>
            {msg && <div className={`rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-line text-muted" : "border-red/30 text-red"}`}>{msg.text}</div>}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Settings" right={<Badge tone="amber">logged</Badge>} />
          <form
            className="space-y-4 p-5 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              const body: Record<string, unknown> = { action: "settings" };
              if (engineRpc) body.engineRpcUrl = engineRpc;
              if (publicRpc) body.publicRpcUrl = publicRpc;
              if (mint) body.tunnelMint = mint;
              if (walletKey) {
                try {
                  body.rewardWallet = sealRewardWallet(walletKey, st.sealPublicKey!);
                } catch (err) {
                  setMsg({ ok: false, text: (err as Error).message });
                  return;
                }
              }
              void act(body, "Settings").then(() => {
                setEngineRpc("");
                setPublicRpc("");
                setMint("");
                setWalletKey("");
              });
            }}
          >
            <label className="block">
              <span className="label mb-1.5 block">Engine RPC URL</span>
              <input type="password" autoComplete="off" value={engineRpc} onChange={(e) => setEngineRpc(e.target.value)} placeholder={st.engineRpcUrl ? "set (hidden) · type to replace" : "https://…"} className={field} />
              <span className="mt-1 block text-[11px] text-faint">Used by the engine for payouts and deposits. May include an API key; never sent to browsers.</span>
            </label>
            <label className="block">
              <span className="label mb-1.5 block">Public RPC URL</span>
              <input value={publicRpc} onChange={(e) => setPublicRpc(e.target.value)} placeholder={st.publicRpcUrl ?? "https://…"} className={field} />
              <span className="mt-1 block text-[11px] text-faint">Used by players&apos; browsers. Visible to everyone, so use a key restricted to this site&apos;s domain.</span>
            </label>
            <div>
              <label htmlFor="admin-mint" className="label mb-1.5 block">
                $TUNNEL mint
              </label>
              <div className="flex gap-2">
                <input id="admin-mint" value={mint} onChange={(e) => setMint(e.target.value)} placeholder={st.tunnelMint ?? "mint address"} className={field} />
                {st.tunnelMint && (
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove the $TUNNEL mint ${st.tunnelMint}? Deposits and withdrawals stop until a mint is set again, and existing player balances will be paid in whichever mint is set next.`,
                        )
                      ) {
                        void act({ action: "settings", tunnelMint: "" }, "Mint removed");
                      }
                    }}
                  >
                    Remove
                  </Button>
                )}
              </div>
              <span className="mt-1 block text-[11px] text-faint">Changing to a different mint is locked while players hold balances or withdrawals are pending; removing is always allowed.</span>
            </div>
            <label className="block">
              <span className="label mb-1.5 block">Reward wallet (vault) secret key</span>
              <textarea
                value={walletKey}
                onChange={(e) => setWalletKey(e.target.value)}
                disabled={!st.sealPublicKey}
                autoComplete="off"
                spellCheck={false}
                rows={2}
                placeholder={!st.sealPublicKey ? "engine offline or ENGINE_SEAL_SECRET missing" : st.rewardWalletSet ? `set: ${shortKey(st.rewardWalletSet)} · paste to replace` : "[12, 34, …] or base58 private key"}
                className="w-full rounded-lg border border-line bg-bg-2 px-2 py-1.5 font-mono text-xs [-webkit-text-security:disc]"
              />
              <span className="mt-1 block text-[11px] leading-relaxed text-faint">
                Encrypted in this browser so only the engine can read it; the site and database never see it. Active vault: {st.rewardWalletActive ? shortKey(st.rewardWalletActive) : "none"}
                {st.rewardWalletSet && st.rewardWalletActive !== st.rewardWalletSet ? ` (switching to ${shortKey(st.rewardWalletSet)})` : ""}. Move the vault&apos;s $TUNNEL and SOL before switching wallets.
              </span>
            </label>
            <Button type="submit" size="sm" disabled={busy || !(engineRpc || publicRpc || mint || walletKey)}>
              Save settings
            </Button>
            <p className="text-[11px] leading-relaxed text-faint">The engine restarts within ~15 s to apply a new engine RPC, mint or wallet. SOLANA_RPC_URL, TUNNEL_MINT and a REWARD_WALLET_KEYPAIR file, when set, take priority.</p>
          </form>
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
          </dl>
          <div className="px-5 pb-5">
            <Button size="sm" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
