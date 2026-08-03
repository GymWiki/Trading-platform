import { Manrope, Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { PlatformHeader } from "@/components/platform/PlatformHeader";
import { PandaHero } from "@/components/platform/PandaHero";
import { PortfolioCard } from "@/components/platform/PortfolioCard";
import { BotOverview } from "@/components/platform/BotOverview";
import { PanicBar } from "@/components/platform/PanicBar";
import type { BotSummary } from "@/components/platform/BotCard";

// Scoped to this page only (not app/layout.tsx) — FreqPanda is its own
// brand exploration and shouldn't change typography anywhere else in the
// app. Space Grotesk carries headlines/figures, Manrope carries body copy,
// IBM Plex Mono carries the small data-y labels (eyebrows, ROI figures).
const displayFont = Space_Grotesk({ subsets: ["latin"], variable: "--font-panda-display" });
const bodyFont = Manrope({ subsets: ["latin"], variable: "--font-panda-body" });
const monoFont = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-panda-mono" });

// Static placeholder data only — shape it exactly like this so plugging in
// real values later is a straight swap, no UI changes needed.
const MOCK_BOTS: BotSummary[] = [
  {
    id: "1",
    name: "Bamboo Scalper",
    mode: "live",
    roiPercent: 3.1,
    lastTradeSummary: "Markt draaide om. Positie veilig gesloten voordat het verlies groter werd.",
  },
  {
    id: "2",
    name: "Steady Trend",
    mode: "paper",
    roiPercent: 1.4,
    lastTradeSummary: "Doel bereikt — winst veiliggesteld op ETH/USDT.",
  },
  {
    id: "3",
    name: "Quiet DCA",
    mode: "live",
    roiPercent: -0.6,
    lastTradeSummary: "Kleine correctie. Bot houdt de positie vast zoals gepland.",
  },
];

export default function PlatformPage() {
  return (
    <div
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} min-h-screen bg-panda-ink font-panda-body text-panda-cream`}
    >
      <PlatformHeader />

      <main className="mx-auto max-w-6xl space-y-6 px-4 pb-28 sm:px-6 sm:pb-10">
        <PandaHero />

        <PortfolioCard totalBalance="€12.480,32" changePercent={2.4} changeLabel="afgelopen 24 uur" />

        <BotOverview bots={MOCK_BOTS} />

        {/* Desktop-inline panic action lives at the end of the content
            flow; the mobile fixed bar (same component) renders itself
            regardless of scroll position. */}
        <PanicBar />
      </main>
    </div>
  );
}
