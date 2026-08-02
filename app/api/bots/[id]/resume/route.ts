import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { deployBotToVps } from "@/lib/deploy-bot";
import { withErrorHandling } from "@/lib/api-handler";

// The only way PAUSED_EMERGENCY (Panic Button) or SLEEPING (Sleep Mode) is
// ever cleared — see lib/bot-status.ts, which blocks every other code path
// from doing it silently. Hetzner has no in-place "resume" for a stopped
// container any more than it has an in-place config update (see
// lib/deploy-bot.ts docs), so this redeploys from scratch — the exact same
// delete-and-recreate primitive every other resume path in this app
// already uses, which is why it also works uniformly for a SLEEPING bot
// whose VPS was merely powered off rather than deleted.
export const POST = withErrorHandling(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bot = await prisma.botConfiguration.findUnique({ where: { id: params.id } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }
  if (bot.status !== "PAUSED_EMERGENCY" && bot.status !== "SLEEPING") {
    return NextResponse.json(
      { error: `Bot is ${bot.status}, niet gepauzeerd — er is niets om te hervatten` },
      { status: 409 },
    );
  }
  if (!bot.aiModelPath) {
    return NextResponse.json({ error: "Geen getraind model gevonden om mee te hervatten" }, { status: 409 });
  }

  try {
    const { bot: updated } = await deployBotToVps({ bot, supabase });
    return NextResponse.json({ bot: updated });
  } catch (err) {
    console.error(`[bots/${bot.id}/resume] Failed to redeploy:`, err);
    const message = err instanceof Error ? err.message : "Failed to resume";
    await prisma.botConfiguration.update({ where: { id: bot.id }, data: { status: "ERROR", lastError: message } });
    return NextResponse.json({ error: message }, { status: 502 });
  }
});
