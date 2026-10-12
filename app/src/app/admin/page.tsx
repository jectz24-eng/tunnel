import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { AdminView } from "./AdminView";

export const metadata: Metadata = { title: "Operations", robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <>
      <PageHeader eyebrow="Operations · admin only" title={<>Control room.</>}>
        Cycles, settlements, payouts and the audit log. Password protected; every change is logged.
      </PageHeader>
      <AdminView />
    </>
  );
}
