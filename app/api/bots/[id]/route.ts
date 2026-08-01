import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { deleteHetznerServer } from "@/lib/hetzner";

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

  const { isPaperTrading } = await req.json();
  if (typeof isPaperTrading !== "boolean") {
    return NextResponse.json({ error: "isPaperTrading must be a boolean" }, { status: 400 });
  }

  const updated = await prisma.botConfiguration.update({
    where: { id: bot.id },
    data: { isPaperTrading },
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
  });

  return NextResponse.json({ bot: updated });
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
