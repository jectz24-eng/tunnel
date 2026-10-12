import type { Metadata } from "next";
import { LiveGame } from "@/components/game/GameApp";

export const metadata: Metadata = {
  title: "Accelerator",
  description: "Pick a barrier, set your particle energy and fire. Every particle that tunnels through pays out in $TUNNEL, instantly and provably fair.",
};

export default function AcceleratorPage() {
  return (
    <>
      <h1 className="sr-only">TUNNEL accelerator</h1>
      <LiveGame />
    </>
  );
}
