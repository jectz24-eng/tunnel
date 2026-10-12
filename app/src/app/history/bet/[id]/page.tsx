import type { Metadata } from "next";
import { BetView } from "./BetView";

export const metadata: Metadata = { title: "Shot", description: "One TUNNEL shot: its seeds, every particle, and an in-browser verification." };

export default async function BetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,19}$/.test(id)) return <p className="p-10 text-muted">Invalid shot id.</p>;
  return <BetView id={id} />;
}
