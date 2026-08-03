import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling, parseJsonBody } from "@/lib/api-handler";

export const dynamic = "force-dynamic";

// A numeric Telegram chat id — negative for a group/channel, positive for
// a direct message with the bot. `null` unlinks. Deliberately not
// validated against the Telegram API itself (that would need a live call
// to our central bot token on every save); a garbage id just means
// freqtrade's own telegram integration silently fails to notify once
// deployed, which is a config.json runtime concern, not a request-shape one.
const telegramBodySchema = z.object({
  telegramChatId: z
    .string()
    .trim()
    .regex(/^-?\d+$/, "Chat ID must be numeric (see /settings for how to find yours)")
    .nullable(),
});

// One Telegram chat per user (not per bot, see prisma/schema.prisma) — every
// bot's config.json gets our central TELEGRAM_BOT_TOKEN + this chat_id
// injected on deploy (see lib/deploy-bot.ts, lib/hetzner.ts).
export const PATCH = withErrorHandling(async (req: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody(req, telegramBodySchema);
  if ("error" in parsed) return parsed.error;

  const profile = await prisma.profile.upsert({
    where: { id: user.id },
    update: { telegramChatId: parsed.data.telegramChatId },
    create: { id: user.id, telegramChatId: parsed.data.telegramChatId },
    select: { telegramChatId: true },
  });

  return NextResponse.json({ telegramChatId: profile.telegramChatId });
});
