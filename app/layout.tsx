import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

// Resolves any relative URL used elsewhere in the Metadata API (OG images,
// canonical links) against the real production domain instead of Next.js's
// localhost fallback. Falls back to NEXT_PUBLIC_APP_URL (see .env.example)
// so this tracks whatever that's set to per environment without a second
// place to update when the domain changes.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: "Freqtrade Command Center",
  description: "Train FreqAI models locally for free. Deploy your bots to the cloud in one click.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
