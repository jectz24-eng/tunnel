import { BarrierChoice } from "@/components/home/BarrierChoice";
import { ArchivePreview, FinalCta, MiningCycles } from "@/components/home/CyclesAndArchive";
import { Hero } from "@/components/home/Hero";
import { LiveAccelerator } from "@/components/home/LiveAccelerator";
import { Phenomenon } from "@/components/home/Phenomenon";
import { PhysicsSection } from "@/components/home/PhysicsSection";
import { ProtocolSteps } from "@/components/home/ProtocolSteps";
import { Reveal } from "@/components/Reveal";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Reveal>
        <Phenomenon />
      </Reveal>
      <Reveal>
        <ProtocolSteps />
      </Reveal>
      <Reveal>
        <LiveAccelerator />
      </Reveal>
      <Reveal>
        <BarrierChoice />
      </Reveal>
      <Reveal>
        <PhysicsSection />
      </Reveal>
      <Reveal>
        <MiningCycles />
      </Reveal>
      <Reveal>
        <ArchivePreview />
      </Reveal>
      <Reveal>
        <FinalCta />
      </Reveal>
    </>
  );
}
