import type { Metadata, Viewport } from "next";
import { Manrope, Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";

// The same FreqPanda type stack app/platform and the landing page
// introduced (Space Grotesk display, Manrope body, IBM Plex Mono
// data/labels) — now loaded app-wide so the rest of the app (dashboard,
// platforms, settings, login, signup) matches instead of staying on Inter.
const bodyFont = Manrope({ subsets: ["latin"], variable: "--font-sans" });
const displayFont = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });
const monoFont = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

// Resolves any relative URL used elsewhere in the Metadata API (OG images,
// canonical links) against the real production domain instead of Next.js's
// localhost fallback. Falls back to NEXT_PUBLIC_APP_URL (see .env.example)
// so this tracks whatever that's set to per environment without a second
// place to update when the domain changes.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: "Freqtrade Command Center",
  description: "Train FreqAI models locally for free. Deploy your bots to the cloud in one click.",
  // Minimal PWA basis — installability itself isn't the point here, an
  // active service worker registration is what the client-side training
  // data Background Fetch (see lib/background-fetch-download.ts) actually
  // needs, but a manifest-less service worker would be an odd half-PWA.
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#14171C",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable} ${monoFont.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}
