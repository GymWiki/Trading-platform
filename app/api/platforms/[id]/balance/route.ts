import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { fetchFreeBalance, BalanceFetchError } from "@/lib/ccxt-client";
import { withErrorHandling } from "@/lib/api-handler";

export const dynamic = "force-dynamic";

// Live refetch — balances aren't persisted (see ExchangeConnection in
// prisma/schema.prisma), so both the /platforms "refresh" button and the
// Go Live modal call this instead of trusting whatever was fetched at
// connection-creation time, which could be stale by minutes or days.
export const GET = withErrorHandling(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connection = await prisma.exchangeConnection.findUnique({ where: { id: params.id } });
  if (!connection || connection.userId !== user.id) {
    return NextResponse.json({ error: "Platform not found" }, { status: 404 });
  }

  try {
    const balance = await fetchFreeBalance(connection.exchangeName, decrypt(connection.apiKey), decrypt(connection.apiSecret));
    return NextResponse.json({ balance });
  } catch (err) {
    const message = err instanceof BalanceFetchError || err instanceof Error ? err.message : "Could not fetch balance";
    return NextResponse.json({ error: message }, { status: 502 });
  }
});
