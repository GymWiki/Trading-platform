import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteHetznerServer } from "@/lib/hetzner";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bot = await prisma.botConfiguration.findUnique({ where: { id: params.id } });
  if (!bot || bot.userId !== session.user.id) {
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
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bot = await prisma.botConfiguration.findUnique({ where: { id: params.id } });
  if (!bot || bot.userId !== session.user.id) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }

  if (bot.deploymentStatus === "VPS_ACTIVE" && bot.hetznerServerId) {
    await deleteHetznerServer(bot.hetznerServerId);
  }

  await prisma.botConfiguration.delete({ where: { id: bot.id } });

  return NextResponse.json({ success: true });
}
