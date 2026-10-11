import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { LaboratoryView } from "./LaboratoryView";

export const metadata: Metadata = {
  title: "Laboratory",
  description: "Interactive quantum tunneling laboratory: adjust particle energy, barrier height and width, and watch the exact wavefunction and transmission probability.",
};

export default function LaboratoryPage() {
  return (
    <>
      <PageHeader eyebrow="Laboratory · open to everyone" title={<>The barrier, up close.</>}>
        Adjust a particle&apos;s energy and a barrier&apos;s height and width. Watch the exact wavefunction leak through, and see how sharply the
        tunneling probability responds. No wallet or tokens needed.
      </PageHeader>
      <LaboratoryView />
    </>
  );
}
