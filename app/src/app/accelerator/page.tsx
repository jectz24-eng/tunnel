import type { Metadata } from "next";
import { AcceleratorApp } from "@/components/accelerator/AcceleratorApp";

export const metadata: Metadata = {
  title: "Accelerator",
  description: "Configure particles, choose a barrier and deploy them into the TUNNEL accelerator. Free energy every cycle; sign a message to mine, no fees.",
};

export default function AcceleratorPage() {
  return (
    <>
      <h1 className="sr-only">TUNNEL accelerator</h1>
      <AcceleratorApp />
    </>
  );
}
