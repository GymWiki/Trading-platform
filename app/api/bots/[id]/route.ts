import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { deleteHetznerServer } from "@/lib/hetzner";
import { botSelect, toBotDTO } from "@/lib/bot-select";
import { withErrorHandling, parseJsonBody } from "@/lib/api-handler";

const patchBodySchema = z.object({
  trainingMode: z.enum(["LOCAL", "CLOUD"]),
});

export const PATCH = withErrorHandling(async (req: NextRequest, { params }: { params: { id: string } }) => {
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

  // isPaperTrading is deliberately not editable here — going live is a
  // one-way, gated action (real balance check + budget commitment) that
  // only app/api/bots/[id]/golive is allowed to perform. A bare PATCH
  // flipping it would bypass that gate entirely.
  const parsed = await parseJsonBody(req, patchBodySchema);
  if ("error" in parsed) return parsed.error;
  const { trainingMode } = parsed.data;

  const updated = await prisma.botConfiguration.update({
    where: { id: bot.id },
    data: { trainingMode },
    select: botSelect,
  });

  return NextResponse.json({ bot: toBotDTO(updated) });
});

export const DELETE = withErrorHandling(async (_req: NextRequest, { params }: { params: { id: string } }) => {
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

  if (bot.deploymentStatus === "VPS_ACTIVE" && bot.hetznerServerId) {
    try {
      await deleteHetznerServer(bot.hetznerServerId);
    } catch (err) {
      console.error(`[bots/${bot.id}] Failed to delete Hetzner server ${bot.hetznerServerId}:`, err);
      const message = err instanceof Error ? err.message : "Failed to delete the VPS";
      return NextResponse.json(
        { error: `Kon de VPS niet opruimen: ${message}. Probeer het opnieuw voordat je de bot verwijdert.` },
        { status: 502 },
      );
    }
  }

  await prisma.botConfiguration.delete({ where: { id: bot.id } });

  return NextResponse.json({ success: true });
});
