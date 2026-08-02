import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/encryption";
import { EXCHANGE_PRESETS } from "@/lib/exchange-presets";
import { exchangeConnectionSelect, toExchangeConnectionDTO } from "@/lib/exchange-connection-select";
import { fetchFreeBalance } from "@/lib/ccxt-client";
import { listPlatformsForUser } from "@/lib/platforms";
import { withErrorHandling, parseJsonBody } from "@/lib/api-handler";

// Closed list, not free text — matches EXCHANGE_PRESETS exactly, same as
// the bot-creation boundary (see app/api/bots/route.ts).
const exchangeIds = EXCHANGE_PRESETS.map((e) => e.id);
const platformBodySchema = z.object({
  exchangeName: z.string().refine((v) => exchangeIds.includes(v), { message: "exchangeName is not a supported exchange" }),
  apiKey: z.string().trim().min(1, "apiKey is required"),
  apiSecret: z.string().trim().min(1, "apiSecret is required"),
});

export const GET = withErrorHandling(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const platforms = await listPlatformsForUser(user.id);
  return NextResponse.json({ platforms });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody(req, platformBodySchema);
  if ("error" in parsed) return parsed.error;
  const { exchangeName, apiKey, apiSecret } = parsed.data;

  let created;
  try {
    created = await prisma.exchangeConnection.create({
      data: {
        userId: user.id,
        exchangeName,
        apiKey: encrypt(apiKey),
        apiSecret: encrypt(apiSecret),
      },
      select: { ...exchangeConnectionSelect, apiKey: true, apiSecret: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "This exchange is already connected" }, { status: 409 });
    }
    throw err;
  }

  // Best-effort — a connection is still worth having saved even if the
  // very first balance check fails (wrong permissions, transient
  // exchange outage); the UI surfaces balanceError per-card and the user
  // can retry via the refresh button.
  let balance = null;
  let balanceError: string | null = null;
  try {
    balance = await fetchFreeBalance(created.exchangeName, decrypt(created.apiKey), decrypt(created.apiSecret));
  } catch (err) {
    console.error(`[platforms] Initial balance fetch failed for connection ${created.id}:`, err);
    balanceError = err instanceof Error ? err.message : "Could not fetch balance";
  }

  return NextResponse.json(
    { platform: { connection: toExchangeConnectionDTO(created), balance, balanceError } },
    { status: 201 },
  );
});
