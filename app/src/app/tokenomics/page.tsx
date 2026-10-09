import type { Metadata } from "next";
import { SectionHeading } from "@/components/ui";
import { TokenomicsView } from "./TokenomicsView";

export const metadata: Metadata = { title: "Tokenomics" };

export default function TokenomicsPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
      <SectionHeading eyebrow="$TUNNEL" title="Tokenomics">
        1,000,000,000 $TUNNEL. 600,000,000 are proposed as the mining reserve; the remaining 400,000,000 are unallocated until the owner approves final
        tokenomics. Live values below are read from the chain.
      </SectionHeading>
      <TokenomicsView />
    </div>
  );
}
