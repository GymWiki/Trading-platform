import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { forceExitAll, stopBot, type FreqtradeCredentials } from "@/lib/freqtrade-client";
import { withErrorHandling } from "@/lib/api-handler";

export const dynamic = "force-dynamic";

interface PanicResult {
  botId: string;
  botName: string;
  ok: boolean;
  error?: string;
}

// The global kill switch: force-closes every open position (market order,
// via /forceexit) and halts the trading loop (/stop) on every one of the
// user's deployed bots, then marks each PAUSED_EMERGENCY so nothing — a
// retrain completing, a redeploy, Go Live — can silently resume one
// afterwards (see lib/bot-status.ts). Only POST /api/bots/[id]/resume, a
// deliberate follow-up action, clears that status.
//
// Deliberately best-effort per bot rather than one try/catch around the
// whole loop: one unreachable VPS must never stop the panic call from
// reaching every other bot. Bots already PAUSED_EMERGENCY/SLEEPING are
// skipped — this is idempotent, not a re-trigger.
export const POST = withErrorHandling(async (_req: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bots = await prisma.botConfiguration.findMany({
    where: {
      userId: user.id,
      deploymentStatus: "VPS_ACTIVE",
      status: { notIn: ["PAUSED_EMERGENCY", "SLEEPING"] },
    },
  });

  if (bots.length === 0) {
    return NextResponse.json({ results: [] as PanicResult[] });
  }

  const results = await Promise.all(
    bots.map(async (bot): Promise<PanicResult> => {
      let closeError: string | undefined;

      if (bot.hetznerServerIp && bot.apiServerUsername && bot.apiServerPassword) {
        const creds: FreqtradeCredentials = {
          serverIp: bot.hetznerServerIp,
          username: bot.apiServerUsername,
          password: decrypt(bot.apiServerPassword),
        };
        try {
          await forceExitAll(creds);
          await stopBot(creds);
        } catch (err) {
          console.error(`[bots/panic] Failed to force-exit/stop bot ${bot.id}:`, err);
          closeError = err instanceof Error ? err.message : "Could not reach the bot's server";
        }
      } else {
        closeError = "No reachable API credentials for this bot's server";
      }

      // The DB status flips to PAUSED_EMERGENCY regardless of whether the
      // exchange-side close actually succeeded — the user's intent ("stop
      // this bot right now") must always be recorded so nothing resumes it
      // silently. A surfaced closeError tells the UI to warn the user to
      // double-check open positions on the exchange itself.
      await prisma.botConfiguration.update({
        where: { id: bot.id },
        data: {
          status: "PAUSED_EMERGENCY",
          lastError: closeError
            ? `Noodstop: kon niet bevestigen dat posities gesloten zijn — ${closeError}`
            : null,
        },
      });

      return { botId: bot.id, botName: bot.botName, ok: !closeError, error: closeError };
    }),
  );

  return NextResponse.json({ results });
});
