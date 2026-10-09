import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SectionHeading } from "@/components/ui";
import { RoundVerification } from "./RoundVerification";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Round ${id}` };
}

export default async function RoundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,20}$/.test(id)) notFound();
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
      <SectionHeading eyebrow="Verification" title={`Round ${Number(id).toLocaleString()}`}>
        Every particle outcome below is recomputed in your browser from the onchain randomness and compared with what the program recorded.
      </SectionHeading>
      <RoundVerification id={id} />
    </div>
  );
}
