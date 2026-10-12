import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { LeaderboardView } from "./LeaderboardView";

export const metadata: Metadata = { title: "Leaderboard", description: "The TUNNEL leaderboard: biggest players, biggest single shots, most tunnels and most shots." };

export default function LeaderboardPage() {
  return (
    <>
      <PageHeader eyebrow="Leaderboard" title={<>Who broke through.</>}>
        The biggest players and the biggest hits in the accelerator, ranked from every recorded shot.
      </PageHeader>
      <LeaderboardView />
    </>
  );
}
