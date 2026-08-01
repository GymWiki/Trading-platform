import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";

// Lets the owner re-view their deployed bot's freqtrade REST API
// credentials after the one-time reveal in the POST /api/deploy response
// has scrolled away. Same encrypt-at-rest pattern as the exchange keys.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
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
  if (!bot.apiServerUsername || !bot.apiServerPassword) {
    return NextResponse.json({ error: "This bot has no deployment credentials yet" }, { status: 404 });
  }

  return NextResponse.json({
    username: bot.apiServerUsername,
    password: decrypt(bot.apiServerPassword),
  });
}
