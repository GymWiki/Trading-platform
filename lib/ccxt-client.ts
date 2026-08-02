import ccxt, { type Exchange, type Balances } from "ccxt";

// Our exchange ids (see lib/exchange-presets.ts) match ccxt's own exchange
// ids almost everywhere — "gate" is the one mismatch (ccxt calls it
// "gateio"). Falls back to the id itself for every other exchange rather
// than requiring a full 1:1 table that would just drift out of sync.
const CCXT_ID_OVERRIDES: Record<string, string> = {
  gate: "gateio",
};

function resolveCcxtId(exchangeName: string): string {
  return CCXT_ID_OVERRIDES[exchangeName] ?? exchangeName;
}

export class BalanceFetchError extends Error {}

export interface FreeBalance {
  asset: "USDT" | "USDC";
  amount: number;
}

// The one place this app talks to a real exchange's balance endpoint —
// used both by /platforms (show what's available right after connecting)
// and the Go Live flow (the $50 minimum-balance gate). Read-only: only
// ever calls fetchBalance, never a trading endpoint, so a connection with
// trade-only API key permissions (no withdraw) still works fully.
export async function fetchFreeBalance(exchangeName: string, apiKey: string, apiSecret: string): Promise<FreeBalance> {
  const ccxtId = resolveCcxtId(exchangeName);
  const ExchangeClass = (ccxt as unknown as Record<string, new (config: Record<string, unknown>) => Exchange>)[
    ccxtId
  ];
  if (!ExchangeClass) {
    throw new BalanceFetchError(`ccxt has no exchange class for "${exchangeName}" (resolved id: "${ccxtId}")`);
  }

  const exchange = new ExchangeClass({
    apiKey,
    secret: apiSecret,
    enableRateLimit: true,
  });

  let balance: Balances;
  try {
    balance = await exchange.fetchBalance();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new BalanceFetchError(`Could not fetch balance from ${exchangeName}: ${message}`);
  }

  // USDT first (the platform's default stake currency everywhere else —
  // see STAKE_CURRENCY in lib/hetzner.ts), USDC as the common fallback for
  // exchanges/accounts that hold their stable balance there instead.
  for (const asset of ["USDT", "USDC"] as const) {
    const free = balance[asset]?.free;
    if (typeof free === "number" && free > 0) {
      return { asset, amount: free };
    }
  }

  return { asset: "USDT", amount: 0 };
}
