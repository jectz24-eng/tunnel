import type { Metadata } from "next";
import { PracticeGame } from "@/components/game/GameApp";
import { PageHeader } from "@/components/ui";
import { LaboratoryView } from "./LaboratoryView";

export const metadata: Metadata = {
  title: "Laboratory",
  description: "Practice runs with free credits: test your TUNNEL strategy on the same barriers, odds and draws as the live accelerator. Then explore the physics behind every barrier.",
};

export default function LaboratoryPage() {
  return (
    <>
      <PageHeader eyebrow="Laboratory · practice runs" title={<>Test your strategy. Risk nothing.</>}>
        Free practice credits, the exact barriers, payouts and draw function of the live accelerator. Try every volatility, every bet size, every particle count until you
        know how you want to play.
      </PageHeader>
      <h2 className="sr-only">Practice accelerator</h2>
      <PracticeGame />
      <div className="mx-auto max-w-[1400px] px-4 pt-10 sm:px-6">
        <div className="eyebrow">Under the hood</div>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">The barrier, up close.</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fg-2">
          Every barrier in TUNNEL is modelled on quantum tunneling. Adjust a particle&apos;s energy and a barrier&apos;s height and width, and watch the wavefunction leak through.
        </p>
      </div>
      <LaboratoryView />
    </>
  );
}
