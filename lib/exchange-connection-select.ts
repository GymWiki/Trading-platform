import { Prisma } from "@prisma/client";
import type { ExchangeConnectionDTO } from "@/lib/types";

// Deliberately excludes apiKey/apiSecret — even encrypted, ciphertext has
// no reason to ever leave the server for this model (unlike
// BotConfiguration, nothing client-side needs to reveal these). Any route
// that needs the real credentials (lib/deploy-bot.ts, lib/ccxt-client.ts
// callers) queries ExchangeConnection directly with its own select instead
// of going through this DTO.
export const exchangeConnectionSelect = {
  id: true,
  exchangeName: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.ExchangeConnectionSelect;

type ExchangeConnectionRow = Prisma.ExchangeConnectionGetPayload<{ select: typeof exchangeConnectionSelect }>;

export function toExchangeConnectionDTO(connection: ExchangeConnectionRow): ExchangeConnectionDTO {
  return connection;
}
