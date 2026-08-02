import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { fetchFreeBalance, type FreeBalance } from "@/lib/ccxt-client";
import { exchangeConnectionSelect, toExchangeConnectionDTO } from "@/lib/exchange-connection-select";
import type { ExchangeConnectionDTO } from "@/lib/types";

export interface PlatformWithBalance {
  connection: ExchangeConnectionDTO;
  balance: FreeBalance | null;
  balanceError: string | null;
}

// Shared by app/platforms/page.tsx (server-rendered initial list) and
// GET /api/platforms (client-side refresh after add/delete) so the
// "query connections, then best-effort live-fetch each balance" logic
// only exists once. Balances are never persisted (see ExchangeConnection
// in prisma/schema.prisma) — every call here hits the real exchange.
export async function listPlatformsForUser(userId: string): Promise<PlatformWithBalance[]> {
  const connections = await prisma.exchangeConnection.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { ...exchangeConnectionSelect, apiKey: true, apiSecret: true },
  });

  return Promise.all(
    connections.map(async (c) => {
      if (!c.isActive) {
        return { connection: toExchangeConnectionDTO(c), balance: null, balanceError: null };
      }
      try {
        const balance = await fetchFreeBalance(c.exchangeName, decrypt(c.apiKey), decrypt(c.apiSecret));
        return { connection: toExchangeConnectionDTO(c), balance, balanceError: null };
      } catch (err) {
        return {
          connection: toExchangeConnectionDTO(c),
          balance: null as FreeBalance | null,
          balanceError: err instanceof Error ? err.message : "Could not fetch balance",
        };
      }
    }),
  );
}
