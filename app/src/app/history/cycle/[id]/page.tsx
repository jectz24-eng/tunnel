import type { Metadata } from "next";
import { CycleView } from "./CycleView";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Cycle #${id}`, description: `Mining cycle ${id}: randomness proof, odds snapshot, positions and in-browser verification.` };
}

export default async function CyclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,19}$/.test(id)) return <p className="p-10 text-muted">Invalid cycle id.</p>;
  return <CycleView id={id} />;
}
