import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { Navbar } from "@/components/Navbar";
import { BotFleetGrid } from "@/components/BotFleetGrid";
import { botSelect, toBotDTO } from "@/lib/bot-select";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [profile, bots] = await Promise.all([
    // A Supabase trigger creates this row on signup (see the profiles
    // migration), but upsert instead of findUniqueOrThrow so a lagging or
    // failed trigger self-heals into a default profile instead of crashing
    // the whole dashboard with a P2025.
    prisma.profile.upsert({
      where: { id: user.id },
      update: {},
      create: { id: user.id },
      select: { vpsBotQuota: true },
    }),
    prisma.botConfiguration.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: botSelect,
    }),
  ]);

  const botDTOs = bots.map(toBotDTO);
  const activeVpsBots = botDTOs.filter((b) => b.deploymentStatus === "VPS_ACTIVE").length;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Bot Fleet</h1>
            <p className="mt-1 text-sm text-slate-400">
              {activeVpsBots} / {profile.vpsBotQuota} cloud slots in use
            </p>
          </div>
        </div>

        <BotFleetGrid initialBots={botDTOs} vpsBotQuota={profile.vpsBotQuota} />
      </main>
    </div>
  );
}
