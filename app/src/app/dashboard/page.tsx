import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui";
import { DashboardView } from "./DashboardView";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6">
      <SectionHeading eyebrow="Dashboard" title="Your mining" />
      <DashboardView />
    </div>
  );
}
