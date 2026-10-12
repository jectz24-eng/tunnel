"use client";

import { useCasino } from "@/lib/game";

/** States plainly when the accelerator is unreachable or paused, so empty values are never mistaken for zeroes. */
export function DeploymentBanner() {
  const casino = useCasino();
  if (casino.data === undefined) return null;
  if (casino.data === null) return <Bar tone="red">TUNNEL is temporarily unreachable. Your balance is safe; live values return as soon as it reconnects.</Bar>;
  if (!casino.data.engineOnline) return <Bar tone="amber">The accelerator is reconnecting. Shots resume in a moment; balances are safe.</Bar>;
  if (!casino.data.bettingOpen) return <Bar tone="amber">The accelerator is paused right now. Withdrawals keep working.</Bar>;
  return null;
}

function Bar({ tone, children }: { tone: "amber" | "red"; children: React.ReactNode }) {
  return (
    <div className={tone === "red" ? "relative z-30 border-b border-red/20 bg-red/[0.06]" : "relative z-30 border-b border-amber/20 bg-amber/[0.05]"}>
      <div className={`mx-auto max-w-[1400px] px-4 py-2 text-center text-xs sm:px-6 ${tone === "red" ? "text-red" : "text-amber"}`}>{children}</div>
    </div>
  );
}
