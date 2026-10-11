"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { TunnelInstructions, deriveOdds, formatPpb, formatTunnel, isGatekeeperEnabled, shortKey, type ProtocolParams } from "@tunnel/sdk";
import { useState } from "react";
import { useWalletAuth } from "@/components/WalletAuth";
import { Badge, Button, Dot, Empty, Panel, PanelHeader } from "@/components/ui";
import { useProtocol } from "@/lib/chain";
import { appConfig, explorerTx } from "@/lib/config";
import { usePoll } from "@/lib/poll";
import { useSendTx } from "@/lib/tx";

const ix = new TunnelInstructions(appConfig.programId);

interface Overview {
  state: Record<string, any> | null;
  failed: { id: string; kind: string; cycleId: string | null; error: string | null; createdAt: string; attempts: number }[];
  recentActions: { id: string; kind: string; cycleId: string | null; status: string; signature: string | null; createdAt: string }[];
  statusCounts: { status: string; count: number }[];
  stuck: { id: string; status: string; closeTs: string }[];
  unclaimed: { positions: number; tokens: string };
  indexer: { lagMs: number | null; cursor: { lastSlot: string } | null; lastEvent: { slot: string; createdAt: string } | null };
}

/**
 * Operations console. Viewing requires a signed-in session whose wallet is
 * the onchain admin (enforced by /api/admin). Every action is an onchain
 * instruction signed by the admin wallet and authorized by the program.
 */
export function AdminView() {
  const { publicKey } = useWallet();
  const auth = useWalletAuth();
  const protocol = useProtocol();
  const p = protocol.data;
  const isAdmin = !!publicKey && !!p && p.admin.equals(publicKey);
  const overview = usePoll<{ status: number; body: { available?: boolean; data?: Overview; error?: string } }>(
    isAdmin && auth.status === "verified" ? "admin:overview" : null,
    async () => {
      const r = await fetch("/api/admin", { cache: "no-store" });
      return { status: r.status, body: await r.json() };
    },
    10_000,
  );
  const { send, state } = useSendTx();
  const [gk, setGk] = useState("");
  const [dur, setDur] = useState("");
  const [emission, setEmission] = useState("");

  if (!publicKey) return <Empty title="Connect the admin wallet">The operations console is only available to the protocol admin.</Empty>;
  if (protocol.loading && p === undefined) return <Empty title="Reading protocol…" />;
  if (!p) return <Empty title="Protocol not initialized on this cluster" />;
  if (!isAdmin) return <Empty title="This wallet is not the protocol admin">Admin: {p.admin.toBase58()}</Empty>;
  if (auth.status !== "verified")
    return (
      <Empty title="Verify the admin wallet">
        <Button className="mt-3" variant="primary" onClick={() => void auth.signIn()}>
          {auth.status === "signing" ? "Sign in your wallet…" : "Sign the login message"}
        </Button>
      </Empty>
    );

  const o = overview.data?.body?.data;
  const params = p.params;
  const update = (next: ProtocolParams) => send([ix.updateParams(publicKey, next)], { computeUnits: 400_000 });
  let preview: string | null = null;
  try {
    preview = deriveOdds(params).transmissionPpb.map((r) => r.map(formatPpb).join(" ")).join(" | ");
  } catch {
    preview = null;
  }

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid min-w-0 gap-5">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-4">
          {[
            ["Status", p.paused ? "PAUSED" : "running"],
            ["Next cycle", `#${p.nextCycleId}`],
            ["Reserve available", formatTunnel(p.reserveAvailable, 0)],
            ["Unclaimed (indexed)", o ? `${formatTunnel(BigInt(o.unclaimed.tokens))} · ${o.unclaimed.positions} pos.` : "—"],
            ["Indexer lag", o?.indexer.lagMs != null ? `${(o.indexer.lagMs / 1000).toFixed(1)} s` : "—"],
            ["Stuck cycles", o ? String(o.stuck.length) : "—"],
            ["Failed crank txs", o ? String(o.failed.length) : "—"],
            ["Gatekeeper", isGatekeeperEnabled(p) ? shortKey(p.gatekeeper.toBase58()) : "off"],
          ].map(([k, v]) => (
            <div key={k} className="bg-panel px-5 py-4">
              <dt className="label">{k}</dt>
              <dd className="mt-1.5 font-mono text-[15px] tabular">{v}</dd>
            </div>
          ))}
        </dl>
        {overview.data && overview.data.status !== 200 && <div className="rounded-lg border border-red/30 bg-red/[0.06] px-4 py-3 text-sm text-red">{overview.data.body.error ?? `HTTP ${overview.data.status}`}</div>}
        {overview.data?.body && overview.data.body.available === false && <div className="rounded-lg border border-amber/30 px-4 py-3 text-sm text-amber">Indexer database unavailable: operational data cannot be shown.</div>}

        <Panel className="overflow-hidden">
          <PanelHeader title="Cycles by status" />
          <div className="flex flex-wrap gap-2 p-5">
            {(o?.statusCounts ?? []).map((s) => (
              <Badge key={s.status} tone={s.status === "void" ? "red" : s.status === "settled" ? "flare" : "neutral"}>
                {s.status} · {s.count}
              </Badge>
            ))}
          </div>
          {o && o.stuck.length > 0 && (
            <div className="border-t border-amber/20 bg-amber/[0.04] px-5 py-3 text-sm text-amber">
              Cycles stuck before settlement for &gt; 5 min: {o.stuck.map((c) => `#${c.id} (${c.status})`).join(", ")}. Check the keeper, the RPC and ORAO fulfillment; after the
              timeout the keeper voids them.
            </div>
          )}
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Failed jobs (keeper)" />
          {!o?.failed.length ? (
            <Empty title="No failed crank transactions" />
          ) : (
            <ul className="divide-y divide-line-soft font-mono text-xs">
              {o.failed.map((f) => (
                <li key={f.id} className="flex flex-wrap gap-3 px-5 py-2.5">
                  <span className="text-faint">{new Date(f.createdAt).toLocaleTimeString()}</span>
                  <span className="text-red">{f.kind}</span>
                  <span>#{f.cycleId}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{f.error}</span>
                  <span className="text-faint">×{f.attempts}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Recent crank activity" />
          <ul className="divide-y divide-line-soft font-mono text-xs">
            {(o?.recentActions ?? []).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
                <Dot color={a.status === "ok" ? "#00D9FF" : a.status === "skipped" ? "#81909F" : "#FF6B7D"} />
                <span className="text-faint">{new Date(a.createdAt).toLocaleTimeString()}</span>
                <span>{a.kind}</span>
                <span className="text-muted">#{a.cycleId}</span>
                {a.signature && (
                  <a className="ml-auto text-cyan hover:underline" href={explorerTx(a.signature)} target="_blank" rel="noreferrer">
                    {a.signature.slice(0, 10)}…
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="grid h-fit gap-5">
        <Panel brackets>
          <PanelHeader title="Onchain controls" right={<Badge tone="amber">admin-signed</Badge>} />
          <div className="space-y-5 p-5 text-sm">
            <div>
              <div className="label mb-2">Deployments</div>
              <Button variant={p.paused ? "primary" : "danger"} onClick={() => send([ix.setPaused(publicKey, !p.paused)])}>
                {p.paused ? "Resume deployments" : "Pause new deployments"}
              </Button>
              <p className="mt-2 text-[11px] text-faint">Pausing never blocks settlement or claims.</p>
            </div>
            <div>
              <div className="label mb-2">Gatekeeper co-signer</div>
              <div className="flex gap-2">
                <input value={gk} onChange={(e) => setGk(e.target.value)} placeholder="gatekeeper public key" className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-bg-2 px-2 font-mono text-xs" />
                <Button size="sm" onClick={() => { try { void send([ix.setGatekeeper(publicKey, new PublicKey(gk))]); } catch { /* invalid key */ } }} disabled={!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(gk)}>
                  Set
                </Button>
              </div>
              {isGatekeeperEnabled(p) && (
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => send([ix.setGatekeeper(publicKey, PublicKey.default)])}>
                  Disable co-signing
                </Button>
              )}
            </div>
            <div>
              <div className="label mb-2">Future cycles</div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input value={dur} onChange={(e) => setDur(e.target.value)} placeholder={`cycle seconds (now ${params.cycleDurationSecs})`} className="h-9 rounded-lg border border-line bg-bg-2 px-2 font-mono text-xs" />
                <Button size="sm" disabled={!/^\d+$/.test(dur)} onClick={() => update({ ...params, cycleDurationSecs: Number(dur) })}>
                  Update
                </Button>
                <input value={emission} onChange={(e) => setEmission(e.target.value)} placeholder={`$TUNNEL per cycle (now ${formatTunnel(params.initialEmissionPerCycle, 0)})`} className="h-9 rounded-lg border border-line bg-bg-2 px-2 font-mono text-xs" />
                <Button size="sm" disabled={!/^\d+$/.test(emission)} onClick={() => update({ ...params, initialEmissionPerCycle: BigInt(emission) * 1_000_000n })}>
                  Update
                </Button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-faint">
                Applies to cycles opened afterwards. Barrier physics and rewards are changed with <code>npm run admin -- set-params</code>; the program
                re-derives the odds. Current odds: {preview}
              </p>
            </div>
            {state.phase !== "idle" && (
              <div className={`rounded-lg border px-3 py-2 text-xs ${state.phase === "failed" ? "border-red/30 text-red" : "border-line text-muted"}`}>
                {state.phase === "failed" ? state.error : state.phase}
                {state.signature && (
                  <a className="ml-2 text-cyan" href={explorerTx(state.signature)} target="_blank" rel="noreferrer">
                    tx
                  </a>
                )}
              </div>
            )}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Authorities" />
          <dl className="space-y-2 p-5 font-mono text-[11px]">
            <div className="flex justify-between gap-2"><dt className="text-muted">admin</dt><dd className="break-all text-right">{p.admin.toBase58()}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">pending</dt><dd>{p.pendingAdmin?.toBase58() ?? "—"}</dd></div>
            <p className="pt-2 text-[11px] leading-relaxed text-faint">Production: transfer admin and the program upgrade authority to a multisig (propose → accept).</p>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
