import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { DeploymentBanner } from "@/components/DeploymentBanner";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { Providers } from "@/components/Providers";
import { SmoothScroll } from "@/components/SmoothScroll";
import { WalletAuthProvider } from "@/components/WalletAuth";
import "lenis/dist/lenis.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "$TUNNEL — Mine through the impossible", template: "%s · $TUNNEL" },
  description:
    "Quantum Tunneling Protocol on Solana. Deploy particles against potential barriers, let verifiable randomness decide what tunnels through, and earn $TUNNEL from a fixed emissions reserve.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#05070B",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh">
        <SmoothScroll />
        <Providers>
          <WalletAuthProvider>
            <Nav />
            <DeploymentBanner />
            <main id="main">{children}</main>
            <Footer />
          </WalletAuthProvider>
        </Providers>
      </body>
    </html>
  );
}
