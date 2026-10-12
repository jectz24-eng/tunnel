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
  description: "Fire particles at quantum barriers on Solana. Pick your volatility, charge your energy, and win $TUNNEL every time a particle tunnels through. Instant, provably fair.",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: { url: "/apple-icon.png", sizes: "180x180" },
  },
  openGraph: { images: [{ url: "/brand/tunnel-logo-1024.png", width: 1024, height: 1024 }] },
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
