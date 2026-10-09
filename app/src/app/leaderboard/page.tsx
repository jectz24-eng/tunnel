import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui";
import { LeaderboardView } from "./LeaderboardView";

export const metadata: Metadata = { title: "Leaderboard" };

export default function LeaderboardPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
      <SectionHeading eyebrow="Leaderboard" title="Top miners">
        Every figure is derived from indexed onchain positions. Sort by any column and filter by period or barrier.
      </SectionHeading>
      <LeaderboardView />
    </div>
  );
}
