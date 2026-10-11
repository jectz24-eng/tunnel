import { BarrierChoice } from "@/components/home/BarrierChoice";
import { ArchivePreview, FinalCta, MiningCycles } from "@/components/home/CyclesAndArchive";
import { Hero } from "@/components/home/Hero";
import { LiveAccelerator } from "@/components/home/LiveAccelerator";
import { Phenomenon } from "@/components/home/Phenomenon";
import { PhysicsSection } from "@/components/home/PhysicsSection";
import { ProtocolSteps } from "@/components/home/ProtocolSteps";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Phenomenon />
      <ProtocolSteps />
      <LiveAccelerator />
      <BarrierChoice />
      <PhysicsSection />
      <MiningCycles />
      <ArchivePreview />
      <FinalCta />
    </>
  );
}
