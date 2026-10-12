"use client";

import { VOLATILITY, formatChance, formatMultiplier, formatTunnel, hashServerSeed, particleDrawFor, resolveBet, shortKey } from "@tunnel/sdk";
import Link from "next/link";
import { useMemo } from "react";
import { Hits } from "@/components/game/Panels";
import { Badge, Dot, Empty, Panel, PanelHeader, Unavailable } from "@/components/ui";
import { useIndexed } from "@/lib/api";
import type { ShotRow } from "../../HistoryView";

interface Seed {
  serverSeedHash: string;
  clientSeed: string;
  serverSeed: string | null;
  active: boolean;
}

/** One shot, re-verified in the browser once its server seed has been revealed. */
export function BetView({ id }: { id: string }) {
  const res = useIndexed<{ bet: ShotRow; seed: Seed | null } | null>(`/api/casino/bets/${id}`, 10_000);
  const d = res.data?.data;
  const check = useMemo(() => {
    if (!d?.bet || !d.seed?.serverSeed) return null;
    const b = d.bet;
    const out = resolveBet({ serverSeed: d.seed.serverSeed, clientSeed: d.seed.clientSeed, nonce: b.nonce, volatility: b.volatility, amount: BigInt(b.amount), count: b.count });
    return {
      hashOk: hashServerSeed(d.seed.serverSeed) === d.seed.serverSeedHash,
      bitsOk: out.hits.map((h) => (h ? "1" : "0")).join("") === b.outcomeBits,
      payoutOk: out.payout === BigInt(b.payout),
      draws: out.hits.map((h, i) => ({ i, draw: particleDrawFor(d.seed!.serverSeed!, d.seed!.clientSeed, b.nonce, i), hit: h })),
    };
  }, [d]);

  if (res.data && !res.data.available) return <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6"><Unavailable what="This shot" /></div>;
  if (!res.data) return <Empty title="Loading shot…" />;
  if (!d) return <Empty title="Shot not found" />;
  const b = d.bet;
  const v = VOLATILITY[b.volatility];
  const net = BigInt(b.payout) - BigInt(b.stake);

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <Panel brackets>
        <PanelHeader title={`Shot #${b.id}`} right={<Badge tone={b.wins > 0 ? "flare" : "amber"}>{b.wins > 0 ? `${b.wins} tunneled` : "reflected"}</Badge>} />
        <dl className="grid grid-cols-2 gap-px bg-line-soft sm:grid-cols-3">
          {[
            ["Player", <Link key="p" href={`/profile/${b.wallet}`} className="hover:text-cyan">{shortKey(b.wallet, 6)}</Link>],
            ["Barrier", <span key="b" style={{ color: v.color }}>{v.name}</span>],
            ["Win chance · pays", `${formatChance(b.winPpb)} · ${formatMultiplier(b.multiplierBps)}`],
            ["Energy per particle", `${formatTunnel(BigInt(b.amount))} $TUNNEL`],
            ["Particles", b.count],
            ["Total bet", `${formatTunnel(BigInt(b.stake))} $TUNNEL`],
            ["Paid", `${formatTunnel(BigInt(b.payout))} $TUNNEL`],
            ["Net", `${net > 0n ? "+" : ""}${formatTunnel(net)}`],
            ["Time", new Date(b.createdAt).toLocaleString()],
          ].map(([k, val]) => (
            <div key={String(k)} className="bg-panel px-5 py-4">
              <dt className="label">{k}</dt>
              <dd className="mt-1.5 font-mono text-[13px]">{val}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-line-soft px-5 py-4">
          <div className="label mb-2">Particles</div>
          <Hits hits={b.outcomeBits.split("").map((x) => x === "1")} max={100} />
        </div>
      </Panel>

      <div className="grid h-fit gap-5">
        <Panel brackets>
          <PanelHeader title="Provably fair" />
          <div className="space-y-3 p-5 font-mono text-[11px]">
            <div>
              <div className="label">Server seed hash</div>
              <div className="mt-1 break-all text-fg-2">{d.seed?.serverSeedHash ?? "—"}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="label">Client seed</div>
                <div className="mt-1 break-all text-fg-2">{d.seed?.clientSeed ?? "—"}</div>
              </div>
              <div>
                <div className="label">Nonce</div>
                <div className="mt-1 text-fg-2">{b.nonce}</div>
              </div>
            </div>
            <div>
              <div className="label">Server seed</div>
              <div className="mt-1 break-all text-fg-2">{d.seed?.serverSeed ?? "hidden until the player rotates their seed"}</div>
            </div>
            <div className="space-y-2 border-t border-line-soft pt-3 font-sans text-[13px]">
              <Check ok={check?.hashOk ?? null} label="Server seed matches the hash shown before the shot" />
              <Check ok={check?.bitsOk ?? null} label="Every particle recomputed in your browser" />
              <Check ok={check?.payoutOk ?? null} label="Payout matches the particles that tunneled" />
            </div>
          </div>
        </Panel>
        {check && (
          <Panel className="overflow-hidden">
            <PanelHeader title="Particle draws" />
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full font-mono text-[10.5px]">
                <tbody>
                  {check.draws.map((x) => (
                    <tr key={x.i} className="border-b border-line-soft last:border-0">
                      <td className="px-4 py-1.5 text-faint">#{x.i}</td>
                      <td className="px-4 py-1.5 text-muted">{x.draw.toString(16).padStart(16, "0")}</td>
                      <td className={`px-4 py-1.5 text-right ${x.hit ? "text-flare" : "text-amber"}`}>{x.hit ? "tunneled" : "reflected"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

function Check({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-1.5">
        <Dot color={ok == null ? "#4c5a69" : ok ? "#00D9FF" : "#FF6B7D"} />
      </span>
      <span className={ok === false ? "text-red" : ok == null ? "text-muted" : "text-fg-2"}>{label}</span>
    </div>
  );
}
