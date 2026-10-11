import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { LeaderboardView } from "./LeaderboardView";

export const metadata: Metadata = { title: "Leaderboard", description: "TUNNEL leaderboards from verified onchain data: tunnels, rewards, particles, best cycle, streaks and activity." };

export default function LeaderboardPage() {
  return (
    <>
      <PageHeader eyebrow="Leaderboard · verified data only" title={<>Who made it through.</>}>
        Rankings are built from settled, reconciled onchain positions. No self-reported numbers.
      </PageHeader>
      <LeaderboardView />
    </>
  );
}
