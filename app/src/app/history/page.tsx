import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { HistoryView } from "./HistoryView";

export const metadata: Metadata = {
  title: "Experiment history",
  description: "Every TUNNEL mining attempt: wallet, cycle, barrier, energy, probability, randomness, outcome, reward and signature.",
};

export default function HistoryPage() {
  return (
    <>
      <PageHeader eyebrow="Experiment history" title={<>Every attempt, on the record.</>}>
        Each experiment is one deployment of particles. Outcomes are derived from the cycle&apos;s public randomness and checked against what the
        program settled. Open a cycle to re-verify it in your browser.
      </PageHeader>
      <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
        <HistoryView />
      </div>
    </>
  );
}
