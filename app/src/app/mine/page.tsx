import type { Metadata } from "next";
import { MineTerminal } from "@/components/mine/MineTerminal";

export const metadata: Metadata = { title: "Mine" };

export default function MinePage() {
  return <MineTerminal />;
}
