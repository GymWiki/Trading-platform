// Thin wrapper around a *deployed* bot's own freqtrade REST API (the same
// api_server every live deployment exposes on :8080, credentialed with the
// random username/password generated in /api/deploy). This is how the
// operational status machine actually enforces a pause — not just a
// database flag, but genuinely halting that instance's trading loop.
//
// Talks plain HTTP: these are short-lived per-bot IPs with no TLS
// termination in front of them yet. Acceptable for now since the only
// caller is our own trusted backend, but worth revisiting before this
// carries anything more sensitive than trade-control commands.
const REQUEST_TIMEOUT_MS = 15_000;

export interface FreqtradeCredentials {
  serverIp: string;
  username: string;
  password: string;
}

async function freqtradeRequest(
  creds: FreqtradeCredentials,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<unknown> {
  const auth = Buffer.from(`${creds.username}:${creds.password}`).toString("base64");

  let res: Response;
  try {
    res = await fetch(`http://${creds.serverIp}:8080/api/v1${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new Error(`Could not reach freqtrade API at ${creds.serverIp}:8080: ${message}`);
  }

  if (!res.ok) {
    throw new Error(`Freqtrade API error (${res.status}) on ${path}: ${await res.text()}`);
  }
  return res.json();
}

// Halts the trading loop — no new entries or exits are opened, but the
// process (and its REST API) keeps running. This is the actual enforcement
// mechanism behind BotStatus.UPDATING_MODEL, not just bookkeeping.
export async function stopBot(creds: FreqtradeCredentials): Promise<void> {
  await freqtradeRequest(creds, "POST", "/stop");
}

export async function startBot(creds: FreqtradeCredentials): Promise<void> {
  await freqtradeRequest(creds, "POST", "/start");
}

// Closes every open position immediately. Only called when the caller
// explicitly opts in (cancelOpenOrders) — pausing entries alone is enough
// to satisfy "never trade during training" without forcing an exit at a
// possibly bad price.
export async function forceExitAll(creds: FreqtradeCredentials): Promise<void> {
  await freqtradeRequest(creds, "POST", "/forceexit", { tradeid: "all" });
}

// One row of freqtrade's own /trades response — a mix of fields this app
// actually uses and nothing more. `exit_reason` is the current field name
// (freqtrade renamed sell_reason -> exit_reason when short support landed);
// `sell_reason` is read as a fallback in lib/trade-humanizer.ts in case an
// older freqtrade image is ever pinned.
export interface FreqtradeTrade {
  trade_id: number;
  pair: string;
  is_open: boolean;
  open_date: string;
  close_date: string | null;
  amount: number;
  open_rate: number;
  close_rate: number | null;
  profit_abs: number | null;
  profit_ratio: number | null;
  exit_reason?: string | null;
  sell_reason?: string | null;
}

// Freqtrade's own trade log for this deployment — the source for both the
// Humanized Trade History feed and (later) the P&L chart, which is exactly
// why profit_abs/close_date are kept in the raw shape rather than trimmed.
// `limit` is a request-time cap on how many of the most recent trades come
// back, not a stored setting.
export async function getTrades(creds: FreqtradeCredentials, limit = 100): Promise<FreqtradeTrade[]> {
  const data = (await freqtradeRequest(creds, "GET", `/trades?limit=${limit}`)) as { trades: FreqtradeTrade[] };
  return data.trades;
}
