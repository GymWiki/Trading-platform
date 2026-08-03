import { redirect } from "next/navigation";
import { Manrope, Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { botSelect, toBotDTO } from "@/lib/bot-select";
import { toBotSummary } from "@/lib/platform-bot-summary";
import { PlatformHeader } from "@/components/platform/PlatformHeader";
import { PandaHero } from "@/components/platform/PandaHero";
import { PortfolioCard } from "@/components/platform/PortfolioCard";
import { BotOverview } from "@/components/platform/BotOverview";
import { PanicBar } from "@/components/platform/PanicBar";

// Scoped to this page only (not app/layout.tsx) — FreqPanda is its own
// brand exploration and shouldn't change typography anywhere else in the
// app. Space Grotesk carries headlines/figures, Manrope carries body copy,
// IBM Plex Mono carries the small data-y labels (eyebrows, ROI figures).
const displayFont = Space_Grotesk({ subsets: ["latin"], variable: "--font-panda-display" });
const bodyFont = Manrope({ subsets: ["latin"], variable: "--font-panda-body" });
const monoFont = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-panda-mono" });

// Now sources real bot data — same Prisma query + botSelect/toBotDTO
// /dashboard itself uses — mapped through lib/platform-bot-summary.ts.
// Touches real user data, so (unlike the original static-only version)
// this page needs the same auth guard every other authenticated page has.
export default async function PlatformPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const bots = await prisma.botConfiguration.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: botSelect,
  });
  const botSummaries = bots.map(toBotDTO).map(toBotSummary);

  return (
    <div
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} min-h-screen bg-panda-ink font-panda-body text-panda-cream`}
    >
      <PlatformHeader />

      <main className="mx-auto max-w-6xl space-y-6 px-4 pb-28 sm:px-6 sm:pb-10">
        <PandaHero />

        {/* Still mock: this is aggregate portfolio P&L, a different
            subsystem (GET /api/bots/pnl) from the per-bot props wired in
            below. See components/PnlChart.tsx on /dashboard for the exact
            pattern to reuse if/when this page needs it too. */}
        <PortfolioCard totalBalance="€12.480,32" changePercent={2.4} changeLabel="afgelopen 24 uur" />

        <BotOverview bots={botSummaries} />

        {/* Desktop-inline panic action lives at the end of the content
            flow; the mobile fixed bar (same component) renders itself
            regardless of scroll position. */}
        <PanicBar />
      </main>
    </div>
  );
}
