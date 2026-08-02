import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/encryption";
import { EXCHANGE_PRESETS } from "@/lib/exchange-presets";
import { exchangeConnectionSelect, toExchangeConnectionDTO } from "@/lib/exchange-connection-select";
import { fetchFreeBalance } from "@/lib/ccxt-client";
import { listPlatformsForUser } from "@/lib/platforms";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const platforms = await listPlatformsForUser(user.id);
  return NextResponse.json({ platforms });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { exchangeName, apiKey, apiSecret } = body ?? {};

  // Closed list, not free text — matches EXCHANGE_PRESETS exactly, same as
  // the bot-creation boundary (see app/api/bots/route.ts).
  if (!EXCHANGE_PRESETS.some((e) => e.id === exchangeName)) {
    return NextResponse.json({ error: "exchangeName is not a supported exchange" }, { status: 400 });
  }
  if (typeof apiKey !== "string" || !apiKey.trim() || typeof apiSecret !== "string" || !apiSecret.trim()) {
    return NextResponse.json({ error: "apiKey and apiSecret are required" }, { status: 400 });
  }

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
    balanceError = err instanceof Error ? err.message : "Could not fetch balance";
  }

  return NextResponse.json(
    { platform: { connection: toExchangeConnectionDTO(created), balance, balanceError } },
    { status: 201 },
  );
}
