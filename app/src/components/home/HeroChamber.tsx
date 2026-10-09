"use client";

import { DEFAULT_PARAMS } from "@tunnel/sdk";
import { TunnelingChamber } from "@/components/chamber/TunnelingChamber";
import { useProtocol } from "@/lib/chain";

export function HeroChamber() {
  const protocol = useProtocol();
  const barriers = protocol.data?.params.barriers ?? DEFAULT_PARAMS.barriers;
  return (
    <div className="panel relative overflow-hidden">
      <div className="flex items-center justify-between border-b border-line-soft px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="label text-fg-2">Tunnelling chamber</span>
          <span className="hidden font-mono text-[10.5px] text-faint sm:inline">1-D rectangular barrier · ψ = e^(ikx) + r·e^(−ikx)</span>
        </div>
        <span className="font-mono text-[10.5px] tracking-[0.1em] text-amber/90">ILLUSTRATIVE SIMULATION</span>
      </div>
      <div className="grid-backdrop pointer-events-none absolute inset-0 top-10 opacity-60" />
      <TunnelingChamber mode="illustrative" barriers={barriers} className="h-[300px] sm:h-[380px] lg:h-[440px]" />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft px-4 py-2.5 font-mono text-[10.5px] text-faint">
        <span>Outcomes shown here are a visual simulation using the configured odds. Live rounds render only onchain results.</span>
        <span className="text-muted">x →</span>
      </div>
    </div>
  );
}
