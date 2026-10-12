import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { HistoryView } from "./HistoryView";

export const metadata: Metadata = {
  title: "Shot history",
  description: "Every shot fired in the TUNNEL accelerator: player, barrier, particles, bet and payout. Open any shot to verify it yourself.",
};

export default function HistoryPage() {
  return (
    <>
      <PageHeader eyebrow="Shot history" title={<>Every shot, on the record.</>}>
        Every particle ever fired, as it landed. Open a shot to see its seeds and replay each particle in your browser.
      </PageHeader>
      <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
        <HistoryView />
      </div>
    </>
  );
}
