import type { Metadata } from "next";
import { ExperimentView } from "./ExperimentView";

export const metadata: Metadata = { title: "Experiment", description: "A single TUNNEL experiment with its physics, randomness and particle-by-particle verification." };

export default async function ExperimentPage({ params }: { params: Promise<{ cycle: string; owner: string; seq: string }> }) {
  const { cycle, owner, seq } = await params;
  if (!/^\d{1,19}$/.test(cycle) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner) || !/^\d{1,5}$/.test(seq)) return <p className="p-10 text-muted">Invalid experiment id.</p>;
  return <ExperimentView cycle={cycle} owner={owner} seq={seq} />;
}
