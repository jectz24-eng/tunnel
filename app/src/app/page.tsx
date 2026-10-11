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
      {/* Slides up over the hero as it dissolves, so there is no dead gap. */}
      <div className="relative z-10 -mt-[60vh] bg-[linear-gradient(to_bottom,transparent,#05070B_22vh)]">
        <Phenomenon />
      </div>
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
