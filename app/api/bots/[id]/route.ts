import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { deleteHetznerServer } from "@/lib/hetzner";
import { botSelect, toBotDTO } from "@/lib/bot-select";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
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

  const body = await req.json();
  const { trainingMode } = body ?? {};

  // isPaperTrading is deliberately not editable here — going live is a
  // one-way, gated action (real balance check + budget commitment) that
  // only app/api/bots/[id]/golive is allowed to perform. A bare PATCH
  // flipping it would bypass that gate entirely.
  if (trainingMode === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  if (trainingMode !== "LOCAL" && trainingMode !== "CLOUD") {
    return NextResponse.json({ error: "trainingMode must be LOCAL or CLOUD" }, { status: 400 });
  }

  const updated = await prisma.botConfiguration.update({
    where: { id: bot.id },
    data: { trainingMode },
    select: botSelect,
  });

  return NextResponse.json({ bot: toBotDTO(updated) });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
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
    await deleteHetznerServer(bot.hetznerServerId);
  }

  await prisma.botConfiguration.delete({ where: { id: bot.id } });

  return NextResponse.json({ success: true });
}
