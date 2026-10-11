"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { DEFAULT_PARAMS, PLACEHOLDER_TOKENOMICS, emissionCurve, formatTunnel, scheduledEmission, type ProtocolParams } from "@tunnel/sdk";
import { Badge, Panel, PanelHeader, Val } from "@/components/ui";
import { useProtocol } from "@/lib/chain";
import { explorerAddress } from "@/lib/config";
import { usePoll } from "@/lib/poll";

/** Live token figures read from chain; allocations that are not configured yet are labelled placeholders. */
export function TokenomicsView() {
  const { connection } = useConnection();
  const protocol = useProtocol();
  const p = protocol.data;
  const loading = protocol.loading && p === undefined;
  const supply = usePoll(p ? `supply:${p.tunnelMint}` : null, async () => BigInt((await connection.getTokenSupply(p!.tunnelMint)).value.amount), 30_000);
  const vault = usePoll(p ? `vault:${p.rewardVault}` : null, async () => BigInt((await connection.getTokenAccountBalance(p!.rewardVault)).value.amount), 10_000);
  const mintInfo = usePoll(p ? `mintinfo:${p.tunnelMint}` : null, async () => {
    const info = await connection.getParsedAccountInfo(p!.tunnelMint);
    const parsed = (info.value?.data as { parsed?: { info?: { mintAuthority: string | null } } })?.parsed;
    return parsed?.info?.mintAuthority ?? null;
  }, 60_000);

  const params: ProtocolParams = p?.params ?? DEFAULT_PARAMS;
  const curve = emissionCurve(params, 2_000, 20);
  const outstanding = p ? p.totalTokensAllocated - p.totalTokensClaimed : null;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5 px-4 py-10 sm:px-6">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-4">
        {[
          ["Total supply (onchain)", supply.data != null ? formatTunnel(supply.data, 0) : null],
          ["Emissions reserve funded", p ? formatTunnel(p.reserveFundedTotal, 0) : null],
          ["Reward vault balance", vault.data != null ? formatTunnel(vault.data, 0) : null],
          ["Reserve not yet committed", p ? formatTunnel(p.reserveAvailable, 0) : null],
          ["Rewards allocated", p ? formatTunnel(p.totalTokensAllocated) : null],
          ["Rewards claimed", p ? formatTunnel(p.totalTokensClaimed) : null],
          ["Claimable, not yet claimed", outstanding != null ? formatTunnel(outstanding) : null],
          ["Next cycle budget", p ? formatTunnel(scheduledEmission(params, p.nextCycleId) < p.reserveAvailable ? scheduledEmission(params, p.nextCycleId) : p.reserveAvailable, 0) : null],
        ].map(([k, v]) => (
          <div key={k} className="bg-panel px-5 py-5">
            <dt className="label">{k}</dt>
            <dd className="mt-2 font-mono text-[19px] tabular">
              <Val v={v} loading={loading} />
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Panel className="overflow-hidden">
          <PanelHeader title="Emission schedule (before the reserve cap)" right={<Badge tone={p ? "cyan" : "amber"}>{p ? "onchain params" : "launch params"}</Badge>} />
          <EmissionChart points={curve.map((c) => ({ x: c.epoch, y: Number(c.cumulative / 10n ** 6n), per: Number(c.perCycle / 10n ** 6n) }))} cap={Number((p?.reserveFundedTotal ?? PLACEHOLDER_TOKENOMICS.miningReserve) / 10n ** 6n)} />
          <div className="border-t border-line-soft px-5 py-3 text-xs leading-relaxed text-muted">
            {formatTunnel(params.initialEmissionPerCycle, 0)} $TUNNEL per cycle, × {(params.emissionDecayBps / 100).toFixed(2)}% every {params.emissionEpochCycles} cycles. Each cycle can
            never take more than what is left in the funded reserve, and pays out only what its particles earned (up to that budget).
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Supply allocation" right={<Badge tone="amber">Placeholder</Badge>} />
          <div className="p-5">
            <AllocationBar />
            <p className="mt-4 text-xs leading-relaxed text-muted">
              Only the emissions reserve has a defined, onchain destination: the program&apos;s reward vault. Final tokenomics (team, liquidity,
              treasury, community) have <b className="text-fg-2">not been supplied</b>; the remaining supply sits unallocated in the operator wallet. These
              figures are placeholders, not commitments.
            </p>
          </div>
        </Panel>
      </div>

      <Panel className="overflow-hidden">
        <PanelHeader title="Onchain addresses" />
        <dl className="divide-y divide-line-soft font-mono text-xs">
          {[
            ["$TUNNEL mint", p?.tunnelMint.toBase58()],
            ["Mint authority", mintInfo.data === null ? "revoked (supply fixed)" : mintInfo.data],
            ["Reward vault (program-owned)", p?.rewardVault.toBase58()],
            ["Protocol account", p?.address.toBase58()],
            ["Admin", p?.admin.toBase58()],
            ["Treasury wallets", "none — the protocol takes no fees"],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-wrap justify-between gap-2 px-5 py-3">
              <dt className="text-muted">{k}</dt>
              <dd className="break-all text-right">
                {v && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) ? (
                  <a className="text-cyan hover:underline" href={explorerAddress(v)} target="_blank" rel="noreferrer">
                    {v}
                  </a>
                ) : (
                  <Val v={v} loading={loading} />
                )}
              </dd>
            </div>
          ))}
        </dl>
        {mintInfo.data && <div className="border-t border-amber/20 bg-amber/[0.05] px-5 py-2.5 text-xs text-amber">The mint authority is still held by the operator. Supply is fixed only after it is revoked.</div>}
      </Panel>
    </div>
  );
}

function EmissionChart({ points, cap }: { points: { x: number; y: number; per: number }[]; cap: number }) {
  const W = 640;
  const H = 240;
  const pad = { l: 56, r: 12, t: 14, b: 28 };
  const maxX = points.at(-1)?.x ?? 1;
  const maxY = Math.max(cap, points.at(-1)?.y ?? 1) * 1.05;
  const x = (v: number) => pad.l + (v / maxX) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / maxY) * (H - pad.t - pad.b);
  const d = points.map((pt, i) => `${i ? "L" : "M"}${x(pt.x).toFixed(1)},${y(Math.min(pt.y, cap)).toFixed(1)}`).join("");
  const fmt = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Cumulative scheduled emissions, capped by the funded reserve">
      <defs>
        <linearGradient id="em-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#00D9FF" stopOpacity="0.25" />
          <stop offset="1" stopColor="#00D9FF" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={pad.l} x2={W - pad.r} y1={y(maxY * f)} y2={y(maxY * f)} stroke="#111a25" />
          <text x={pad.l - 8} y={y(maxY * f) + 3.5} textAnchor="end" className="fill-[#4c5a69] font-mono text-[10px]">
            {fmt(Math.round(maxY * f))}
          </text>
        </g>
      ))}
      <line x1={pad.l} x2={W - pad.r} y1={y(cap)} y2={y(cap)} stroke="#F0A64B" strokeDasharray="4 4" />
      <text x={W - pad.r} y={y(cap) - 6} textAnchor="end" className="fill-[#F0A64B] font-mono text-[10px]">
        reserve cap
      </text>
      <path d={`${d}L${x(maxX)},${y(0)}L${x(0)},${y(0)}Z`} fill="url(#em-g)" />
      <path d={d} fill="none" stroke="#00D9FF" strokeWidth="1.8" />
      <text x={W - pad.r} y={H - 8} textAnchor="end" className="fill-[#81909f] font-mono text-[10px]">
        epochs →
      </text>
    </svg>
  );
}

function AllocationBar() {
  const total = Number(PLACEHOLDER_TOKENOMICS.totalSupply / 10n ** 6n);
  const reserve = Number(PLACEHOLDER_TOKENOMICS.miningReserve / 10n ** 6n);
  const segs = [
    { label: "Emissions reserve (mining)", v: reserve, c: "#00D9FF" },
    { label: "Unallocated — pending final tokenomics", v: total - reserve, c: "#26364a" },
  ];
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full">
        {segs.map((s) => (
          <div key={s.label} style={{ width: `${(s.v / total) * 100}%`, background: s.c }} />
        ))}
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {segs.map((s) => (
          <li key={s.label} className="flex items-center gap-3">
            <span className="size-2.5 rounded-sm" style={{ background: s.c }} />
            <span className="flex-1 text-fg-2">{s.label}</span>
            <span className="font-mono text-xs text-muted">{s.v.toLocaleString()} · {((s.v / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 font-mono text-[10.5px] text-faint">PLACEHOLDER: 1,000,000,000 total / 600,000,000 reserve until configured</p>
    </div>
  );
}
