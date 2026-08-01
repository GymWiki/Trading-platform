import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { Navbar } from "@/components/Navbar";
import { BotFleetGrid } from "@/components/BotFleetGrid";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [profile, bots] = await Promise.all([
    prisma.profile.findUniqueOrThrow({
      where: { id: user.id },
      select: { vpsBotQuota: true },
    }),
    prisma.botConfiguration.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        botName: true,
        exchangeName: true,
        strategy: true,
        pairWhitelist: true,
        stakeAmount: true,
        isPaperTrading: true,
        deploymentStatus: true,
        aiModelPath: true,
        hetznerServerIp: true,
        createdAt: true,
      },
    }),
  ]);

  const activeVpsBots = bots.filter((b) => b.deploymentStatus === "VPS_ACTIVE").length;

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

        <BotFleetGrid initialBots={bots} vpsBotQuota={profile.vpsBotQuota} />
      </main>
    </div>
  );
}
