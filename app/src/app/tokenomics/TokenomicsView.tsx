"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { PLACEHOLDER_TOKENOMICS, formatTunnel } from "@tunnel/sdk";
import { Badge, Panel, PanelHeader, Val } from "@/components/ui";
import { useProtocol } from "@/lib/chain";
import { useCasino } from "@/lib/game";
import { explorerAddress } from "@/lib/config";
import { usePoll } from "@/lib/poll";

/** Live token figures from Solana and the accelerator; unfinished allocations are labelled placeholders. */
export function TokenomicsView() {
  const { connection } = useConnection();
  const protocol = useProtocol();
  const p = protocol.data;
  const loading = protocol.loading && p === undefined;
  const mint = p?.tunnelMint ?? null;
  const supply = usePoll(mint ? `supply:${mint}` : null, async () => BigInt((await connection.getTokenSupply(new PublicKey(mint!))).value.amount), 30_000);
  const mintInfo = usePoll(mint ? `mintinfo:${mint}` : null, async () => {
    const info = await connection.getParsedAccountInfo(new PublicKey(mint!));
    const parsed = (info.value?.data as { parsed?: { info?: { mintAuthority: string | null } } })?.parsed;
    return parsed?.info?.mintAuthority ?? null;
  }, 60_000);

  const casino = useCasino();
  const t = casino.data?.totals;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5 px-4 py-10 sm:px-6">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-4">
        {[
          ["Total supply (on Solana)", supply.data != null ? formatTunnel(supply.data, 0) : null],
          ["Vault balance", p?.rewardWalletTokens != null ? formatTunnel(p.rewardWalletTokens, 0) : p ? "—" : null],
          ["$TUNNEL wagered", t ? formatTunnel(t.wagered, 0) : null],
          ["Shots fired", t ? t.bets.toLocaleString() : null],
        ].map(([k, v]) => (
          <div key={k} className="bg-panel px-5 py-5">
            <dt className="label">{k}</dt>
            <dd className="mt-2 font-mono text-[19px] tabular">
              <Val v={v} loading={loading} />
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-5">
        <Panel className="overflow-hidden">
          <PanelHeader title="Supply allocation" right={<Badge tone="amber">Placeholder</Badge>} />
          <div className="p-5">
            <AllocationBar />
            <p className="mt-4 text-xs leading-relaxed text-muted">
              The vault holds the $TUNNEL that backs every payout in the accelerator. The final split of the remaining supply (team, liquidity, community) will be
              published before launch; until then these figures are <b className="text-fg-2">placeholders</b>, not commitments.
            </p>
          </div>
        </Panel>
      </div>

      <Panel className="overflow-hidden">
        <PanelHeader title="Addresses" />
        <dl className="divide-y divide-line-soft font-mono text-xs">
          {[
            ["$TUNNEL mint", p?.tunnelMint ?? undefined],
            ["Mint authority", mintInfo.data === null ? "revoked (supply fixed)" : mintInfo.data],
            ["Vault (deposits & payouts)", p?.rewardWallet ?? undefined],
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

function AllocationBar() {
  const total = Number(PLACEHOLDER_TOKENOMICS.totalSupply / 10n ** 6n);
  const reserve = Number(PLACEHOLDER_TOKENOMICS.miningReserve / 10n ** 6n);
  const segs = [
    { label: "Accelerator vault", v: reserve, c: "#00D9FF" },
    { label: "To be announced", v: total - reserve, c: "#26364a" },
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
      <p className="mt-3 font-mono text-[10.5px] text-faint">PLACEHOLDER SPLIT · FINAL NUMBERS ANNOUNCED AT LAUNCH</p>
    </div>
  );
}
