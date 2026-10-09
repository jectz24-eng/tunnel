import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui";
import { StatsView } from "./StatsView";

export const metadata: Metadata = { title: "Statistics" };

export default function StatsPage() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6">
      <SectionHeading eyebrow="Statistics" title="Protocol statistics">
        Aggregates from the indexer, which ingests every program event and continuously reconciles against onchain accounts. Observed success rates
        are shown next to the configured probabilities.
      </SectionHeading>
      <StatsView />
    </div>
  );
}
