import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { Providers } from "@/components/Providers";
import { WalletAuthProvider } from "@/components/WalletAuth";
import { DeploymentBanner } from "@/components/DeploymentBanner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TUNNEL — Mine through the impossible", template: "%s · TUNNEL" },
  description: "Deploy particles. Challenge quantum barriers. Mine $TUNNEL on Solana. A quantum-inspired mining protocol with onchain settlement and verifiable outcomes.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#05070A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh">
        <Providers>
          <WalletAuthProvider>
            <Nav />
            <DeploymentBanner />
            <main>{children}</main>
            <Footer />
          </WalletAuthProvider>
        </Providers>
      </body>
    </html>
  );
}
