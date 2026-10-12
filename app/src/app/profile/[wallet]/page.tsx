import type { Metadata } from "next";
import { ProfileView } from "./ProfileView";

export const metadata: Metadata = { title: "Player", description: "A TUNNEL player: shots, tunnel rate, volume and biggest hits." };

export default async function ProfilePage({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) return <p className="p-10 text-muted">Invalid wallet address.</p>;
  return <ProfileView wallet={wallet} />;
}
