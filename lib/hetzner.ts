import { isSafePythonIdentifier } from "@/lib/strategy-validation";
import type { FreqAIProfileConfig } from "@/lib/strategy-presets";
import { EXCHANGE_PRESETS } from "@/lib/exchange-presets";

const HETZNER_API_BASE = "https://api.hetzner.cloud/v1";

function requireHetznerToken(): string {
  const token = process.env.HETZNER_API_TOKEN;
  if (!token) {
    throw new Error(
      "HETZNER_API_TOKEN is not set (checked in lib/hetzner.ts, requireHetznerToken()) — " +
        "set it in the Vercel project's Environment Variables before provisioning, stopping, or deleting a VPS.",
    );
  }
  return token;
}

// Every call in this file goes through here so a slow/hanging Hetzner API
// can't hang the Vercel function that's awaiting it (provisioning/deleting
// a VPS, both of which run inline in an API route — see lib/deploy-bot.ts,
// app/api/bots/[id]/route.ts), and so a DNS/network failure surfaces as a
// clear message instead of an unhandled TypeError.
const HETZNER_TIMEOUT_MS = 15_000;

async function hetznerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HETZNER_TIMEOUT_MS);
  try {
    return await fetch(`${HETZNER_API_BASE}${path}`, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Hetzner API request timed out after ${HETZNER_TIMEOUT_MS / 1000}s (${path})`);
    }
    throw new Error(`Could not reach Hetzner API: ${err instanceof Error ? err.message : "Unknown error"}`);
  } finally {
    clearTimeout(timeout);
  }
}

type FirewallProfile = "live-trading" | "training";

// Creates (or reuses) a Hetzner Cloud Firewall for the given profile and
// returns its id. "live-trading" opens only what a deployed bot actually
// needs (the freqtrade REST API, plus SSH only if a key is configured);
// "training" opens nothing at all — the ephemeral training VM never
// listens on any port, it only makes outbound calls.
async function ensureFirewall(profile: FirewallProfile): Promise<number> {
  const token = requireHetznerToken();
  const name = `freqtrade-command-center-${profile}`;

  const listRes = await hetznerFetch(`/firewalls?name=${encodeURIComponent(name)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) {
    throw new Error(`Hetzner API error (${listRes.status}): ${await listRes.text()}`);
  }
  const { firewalls } = (await listRes.json()) as { firewalls: Array<{ id: number }> };
  if (firewalls?.[0]?.id) return firewalls[0].id;

  const rules =
    profile === "live-trading"
      ? [
          {
            direction: "in",
            protocol: "tcp",
            port: "8080",
            source_ips: ["0.0.0.0/0", "::/0"],
            description: "Freqtrade REST API / FreqUI",
          },
          ...(process.env.HETZNER_SSH_KEY_ID
            ? [
                {
                  direction: "in",
                  protocol: "tcp",
                  port: "22",
                  source_ips: ["0.0.0.0/0", "::/0"],
                  description: "SSH (key-only auth)",
                },
              ]
            : []),
        ]
      : [];

  const createRes = await hetznerFetch(`/firewalls`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, rules, labels: { app: "freqtrade-command-center" } }),
  });
  if (!createRes.ok) {
    throw new Error(`Hetzner API error (${createRes.status}): ${await createRes.text()}`);
  }
  const { firewall } = (await createRes.json()) as { firewall: { id: number } };
  return firewall.id;
}

interface CreateServerParams {
  name: string;
  cloudInit: string;
  serverType?: string;
  /** Attaches the matching Hetzner Cloud Firewall. Omit only for servers that should have no inbound rules managed at all. */
  firewallProfile?: FirewallProfile;
}

interface HetznerServerResponse {
  server: {
    id: number;
    name: string;
    public_net: { ipv4?: { ip: string } };
    status: string;
  };
  action: { id: number; status: string };
}

export async function createHetznerServer({
  name,
  cloudInit,
  serverType,
  firewallProfile,
}: CreateServerParams): Promise<HetznerServerResponse> {
  const token = requireHetznerToken();
  const firewallId = firewallProfile ? await ensureFirewall(firewallProfile) : undefined;

  const res = await hetznerFetch(`/servers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      server_type: serverType || process.env.HETZNER_SERVER_TYPE || "cx11",
      image: process.env.HETZNER_IMAGE || "ubuntu-24.04",
      location: process.env.HETZNER_LOCATION || "nbg1",
      user_data: cloudInit,
      ssh_keys: process.env.HETZNER_SSH_KEY_ID ? [process.env.HETZNER_SSH_KEY_ID] : undefined,
      firewalls: firewallId ? [{ firewall: firewallId }] : undefined,
      labels: { app: "freqtrade-command-center" },
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Hetzner API error (${res.status}): ${errorBody}`);
  }

  return res.json();
}

export async function deleteHetznerServer(serverId: string): Promise<void> {
  const token = requireHetznerToken();

  const res = await hetznerFetch(`/servers/${serverId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok && res.status !== 404) {
    const errorBody = await res.text();
    throw new Error(`Hetzner API error (${res.status}): ${errorBody}`);
  }
}

// Sleep Mode: powers the VM off (immediate, hard poweroff — safe here
// since only paper-trading bots with no real position at risk are ever
// eligible, see app/api/bots/sleep-sweep) without deleting it, so Hetzner
// stops billing for compute while still billing the (much cheaper) disk.
// Resuming (POST /api/bots/[id]/resume) still goes through the normal
// delete-and-recreate redeploy path — deleteHetznerServer works fine on an
// already-powered-off server, so no special-casing is needed there.
export async function stopHetznerServer(serverId: string): Promise<void> {
  const token = requireHetznerToken();

  const res = await hetznerFetch(`/servers/${serverId}/actions/poweroff`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok && res.status !== 404) {
    const errorBody = await res.text();
    throw new Error(`Hetzner API error (${res.status}): ${errorBody}`);
  }
}

// Defense in depth: app/api/bots/route.ts already rejects an unsafe
// `strategy` value at creation time, but this function shouldn't blindly
// trust callers for something used as a filesystem path.
function assertSafePythonIdentifier(value: string, label: string): void {
  if (!isSafePythonIdentifier(value)) {
    throw new Error(`${label} must be a valid Python identifier (got: ${JSON.stringify(value)})`);
  }
}

// Renders a cloud-init `write_files` entry. Content lands in the target
// file completely verbatim — no shell involved, so arbitrary strategy
// source (quotes, `$`, backticks, anything) is always safe here, unlike
// content destined for a shell script (see shellEscapeDouble below).
function writeFilesBlock(entries: Array<{ path: string; content: string; permissions?: string }>): string {
  return entries
    .map(({ path, content, permissions = "0644" }) => {
      const indented = content
        .split("\n")
        .map((line) => `      ${line}`)
        .join("\n");
      return `  - path: ${path}\n    permissions: '${permissions}'\n    content: |\n${indented}`;
    })
    .join("\n");
}

const STAKE_CURRENCY = "USDT";
// How many of the exchange's top-liquid USDT markets VolumePairList hands
// to FreqAI when auto-select is on — wide enough for the AI to find real
// opportunities, small enough that feature engineering/backtesting for a
// single training run stays bounded.
const AUTO_PAIRLIST_SIZE = 30;

// The taker fee freqtrade uses to simulate costs during backtesting/
// dry-run (config's top-level "fee" key — see EXCHANGE_PRESETS for the
// per-exchange source data). Falls back to a conservative 0.1% if the
// exchange somehow isn't in our list — app/api/bots/route.ts already
// rejects that at creation time, so this is defense in depth, not the
// primary guard.
function lookupExchangeFee(exchangeName: string): number {
  return EXCHANGE_PRESETS.find((e) => e.id === exchangeName)?.takerFee ?? 0.001;
}

const TIMEFRAME_MINUTES: Record<string, number> = {
  "1m": 1,
  "3m": 3,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "2h": 120,
  "4h": 240,
  "6h": 360,
  "8h": 480,
  "12h": 720,
  "1d": 1440,
};

// Falls back to 60 (1h) for a timeframe we don't recognize — a
// conservative middle ground that neither wildly over- nor
// under-estimates a download-range buffer.
function timeframeToMinutes(timeframe: string): number {
  return TIMEFRAME_MINUTES[timeframe] ?? 60;
}

interface PairlistConfig {
  pair_whitelist: string[];
  pairlists: Array<Record<string, unknown>>;
}

// FreqAI needs some universe of pairs to run its per-candle predictions
// against. Auto-select hands that choice to freqtrade's own VolumePairList
// instead of a fixed list the user typed in: it re-ranks the exchange's
// USDT markets by 24h quote volume on every refresh_period and feeds
// whatever's currently most liquid to the strategy, so the bot keeps
// trading where there's real volume instead of stalling on a pair that
// went quiet. Manual mode is the opposite trade-off — a fixed, predictable
// set the user explicitly chose — via StaticPairList. Shared by both
// cloud-init builders below so live trading and FreqAI training (which
// still resolves its pairlist through freqtrade's own `download-data`/
// `backtesting`, not a hardcoded --pairs list) always agree on what
// "the bot's pairs" means for a given bot.
function buildPairlistConfig(autoSelectCoins: boolean, pairWhitelist: string[]): PairlistConfig {
  if (autoSelectCoins) {
    return {
      pair_whitelist: [`.*/${STAKE_CURRENCY}`],
      pairlists: [
        {
          method: "VolumePairList",
          number_assets: AUTO_PAIRLIST_SIZE,
          sort_key: "quoteVolume",
          min_value: 0,
          refresh_period: 1800,
        },
      ],
    };
  }
  return {
    pair_whitelist: pairWhitelist,
    pairlists: [{ method: "StaticPairList" }],
  };
}

interface CloudInitParams {
  botName: string;
  exchangeName: string;
  exchangeApiKey: string;
  exchangeApiSecret: string;
  strategy: string;
  strategyCode: string;
  /** Every bot runs FreqAI — this drives the generated freqai config.json block (see lib/strategy-presets.ts). */
  freqaiConfig: FreqAIProfileConfig;
  /** When true, pairWhitelist below is ignored and VolumePairList picks the pairs instead (see buildPairlistConfig). */
  autoSelectCoins: boolean;
  /** The user's manual pair selection — only used when autoSelectCoins is false. */
  pairWhitelist: string[];
  /** Total amount (stake_currency) this bot may put to work. freqtrade itself is told "unlimited" — custom_stake_amount in the strategy code is the real sizing logic, reading this back via custom_user_settings. */
  totalBudget: number;
  /** Hard ceiling, as a percent of totalBudget, custom_stake_amount enforces on any single trade. */
  maxStakePercentage: number;
  isPaperTrading: boolean;
  /** Snowball mode — see BotConfiguration.autoCompound in prisma/schema.prisma. Read back out of custom_user_settings by custom_stake_amount (lib/strategy-presets.ts) to size off the live wallet instead of the fixed totalBudget snapshot. */
  autoCompound: boolean;
  /**
   * Caps what fraction of the *whole* exchange wallet freqtrade may ever
   * touch — only meaningful (and only ever passed) when autoCompound is on
   * for a live deployment; lib/deploy-bot.ts computes it from
   * totalBudget/liveBalance at deploy time so a real, growing account
   * balance still can't be traded beyond what the user actually allocated
   * to this bot. Omitted for paper trading (the dry-run wallet is already
   * fully virtual — there's no other real balance to protect) and left
   * undefined whenever autoCompound is off, in which case freqtrade's own
   * default (0.99) applies.
   */
  tradableBalanceRatio?: number;
  aiModelDownloadUrl?: string;
  apiServerUsername: string;
  apiServerPassword: string;
  apiServerJwtSecret: string;
  /** POST /api/bots/[id]/status on this deployment — lets the running instance report retraining/error events back. */
  statusWebhookUrl: string;
  /** One-time bearer token for the above, hashed and stored as BotConfiguration.statusWebhookTokenHash. */
  statusWebhookToken: string;
  /**
   * Our single central Telegram bot's token (process.env.TELEGRAM_BOT_TOKEN)
   * — the same bot for every user, distinguished only by which chat_id it's
   * telling to notify. Both this and telegramChatId must be present for
   * freqtrade's own telegram integration to turn on; either missing (no
   * server-wide token configured, or this user never linked a chat) just
   * silently skips the block, exactly like aiModelDownloadUrl being absent
   * skips the model-download step.
   */
  telegramBotToken?: string;
  /** This bot owner's linked chat — see Profile.telegramChatId in prisma/schema.prisma. */
  telegramChatId?: string;
}

// Builds a cloud-init script that installs Docker, writes the strategy
// source, Freqtrade config.json, and webhook.json (this bot's
// POST /api/bots/[id]/status URL + token), (optionally) fetches the
// uploaded .joblib FreqAI model, and starts the container. Callers must
// attach the "live-trading" firewall profile (see createHetznerServer)
// since this opens the REST API on 0.0.0.0:8080 — that's why real,
// per-deployment api_server credentials are required params here rather
// than a constant.
export function buildFreqtradeCloudInit(params: CloudInitParams): string {
  const {
    botName,
    exchangeName,
    exchangeApiKey,
    exchangeApiSecret,
    strategy,
    strategyCode,
    freqaiConfig,
    autoSelectCoins,
    pairWhitelist,
    totalBudget,
    maxStakePercentage,
    isPaperTrading,
    autoCompound,
    tradableBalanceRatio,
    aiModelDownloadUrl,
    apiServerUsername,
    apiServerPassword,
    apiServerJwtSecret,
    statusWebhookUrl,
    statusWebhookToken,
    telegramBotToken,
    telegramChatId,
  } = params;

  assertSafePythonIdentifier(strategy, "strategy");
  const safeBotName = botName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const pairlistConfig = buildPairlistConfig(autoSelectCoins, pairWhitelist);

  const freqtradeConfig = {
    max_open_trades: 5,
    stake_currency: STAKE_CURRENCY,
    // "unlimited" hands sizing entirely to custom_stake_amount in the
    // strategy code, which reads total_budget/max_stake_pct back out of
    // custom_user_settings below — a fixed config.json number can't scale
    // with FreqAI's own per-trade confidence the way that function does.
    stake_amount: "unlimited",
    // Used by freqtrade to simulate trading costs in backtests and
    // dry-run (real live trades read the exchange's actual fill fees
    // instead) — without this, dry-run defaults to a generic ~0.25% that
    // may not match the exchange the user actually picked, understating
    // or overstating how much a scalping strategy's paper P&L would
    // really keep after costs.
    fee: lookupExchangeFee(exchangeName),
    dry_run: isPaperTrading,
    dry_run_wallet: totalBudget,
    cancel_open_orders_on_exit: false,
    trading_mode: "spot",
    // Not read by freqtrade core — this is how the strategy's
    // custom_stake_amount (see lib/strategy-presets.ts) gets the user's
    // budget, per-trade risk ceiling, and snowball preference out of
    // config.json.
    custom_user_settings: {
      total_budget: totalBudget,
      max_stake_pct: maxStakePercentage,
      auto_compound: autoCompound,
    },
    // freqtrade's own real setting (not custom_user_settings) — the safety
    // margin on top of custom_stake_amount's own ceiling, so a bug or an
    // unexpectedly large live balance still can't make freqtrade try to
    // use funds outside what this bot was ever allocated. Absent whenever
    // it wasn't computed (paper trading, or autoCompound off) — freqtrade
    // defaults to 0.99 on its own.
    ...(tradableBalanceRatio !== undefined && { tradable_balance_ratio: tradableBalanceRatio }),
    exchange: {
      name: exchangeName,
      key: exchangeApiKey,
      secret: exchangeApiSecret,
      ccxt_config: {},
      ccxt_async_config: {},
      pair_whitelist: pairlistConfig.pair_whitelist,
      pair_blacklist: [],
    },
    pairlists: pairlistConfig.pairlists,
    strategy,
    // Every bot runs FreqAI — freqaimodel is a top-level config key (also
    // settable via --freqaimodel on the CLI, which the training pipeline
    // uses instead; here the strategy is started via `trade`, so it has to
    // go in config.json).
    freqaimodel: freqaiConfig.freqaiModel,
    ...(freqaiConfig.positionAdjustment?.enabled && {
      position_adjustment_enable: true,
      max_entry_position_adjustment: freqaiConfig.positionAdjustment.maxEntryPositionAdjustment,
    }),
    freqai: aiModelDownloadUrl
      ? {
          enabled: true,
          identifier: `${safeBotName}-model`,
          train_period_days: freqaiConfig.training.trainPeriodDays,
          backtest_period_days: freqaiConfig.training.backtestPeriodDays,
          live_retrain_hours: freqaiConfig.training.liveRetrainHours,
          feature_parameters: {
            include_timeframes: freqaiConfig.features.includeTimeframes,
            indicator_periods_candles: freqaiConfig.features.indicatorPeriods,
          },
          data_split_parameters: { test_size: 0.25 },
        }
      : undefined,
    api_server: {
      enabled: true,
      listen_ip_address: "0.0.0.0",
      listen_port: 8080,
      jwt_secret_key: apiServerJwtSecret,
      username: apiServerUsername,
      password: apiServerPassword,
    },
    // freqtrade's own built-in Telegram integration — no notification-
    // sending code of our own needed, it messages the chat directly from
    // inside the container on every entry/exit. Omitted entirely (rather
    // than enabled: false) whenever either half is missing, so an unset
    // server-wide token or an unlinked user never even renders the block.
    ...(telegramBotToken &&
      telegramChatId && {
        telegram: {
          enabled: true,
          token: telegramBotToken,
          chat_id: telegramChatId,
        },
      }),
  };

  const configJson = JSON.stringify(freqtradeConfig, null, 2);

  // Not consumed by freqtrade itself — this is the integration point for a
  // custom FreqAI model class or strategy callback (both fully under the
  // user's control via strategyCode) to report "retrain_needed" or
  // "training_complete" back to our backend. Vanilla freqtrade has no
  // built-in hook for "I just retrained", so wiring this up is on the
  // strategy/model code; we just guarantee the credentials are there.
  const webhookJson = JSON.stringify({ url: statusWebhookUrl, token: statusWebhookToken }, null, 2);

  // Each runcmd entry is rendered via JSON.stringify — JSON's double-quoted
  // string syntax is valid YAML flow-scalar syntax, which guarantees a `#`,
  // `"`, or `\` in an interpolated URL can never be misread as a YAML
  // comment or break the surrounding quoting.
  const runcmdSteps = [
    "systemctl enable docker",
    "systemctl start docker",
    ...(aiModelDownloadUrl
      ? [
          "mkdir -p /opt/freqtrade/user_data/models",
          `curl -fsSL "${aiModelDownloadUrl}" -o /opt/freqtrade/user_data/models/${safeBotName}-model.joblib`,
        ]
      : []),
    `docker run -d --name ${safeBotName} --restart unless-stopped -v /opt/freqtrade/user_data:/freqtrade/user_data -p 8080:8080 freqtradeorg/freqtrade:stable trade --config /freqtrade/user_data/config.json --strategy ${strategy}`,
  ];
  const runcmdYaml = runcmdSteps.map((step) => `  - ${JSON.stringify(step)}`).join("\n");

  return `#cloud-config
package_update: true
packages:
  - docker.io
  - docker-compose-plugin

write_files:
${writeFilesBlock([
  { path: "/opt/freqtrade/user_data/config.json", content: configJson },
  { path: `/opt/freqtrade/user_data/strategies/${strategy}.py`, content: strategyCode },
  { path: "/opt/freqtrade/user_data/webhook.json", content: webhookJson, permissions: "0600" },
])}

runcmd:
${runcmdYaml}
`;
}

// Escapes a value for safe embedding inside a double-quoted bash string
// literal (VAR="value"). Without this, a bot name or strategy containing
// `"`, `` ` ``, or `$` could break out of the assignment and inject
// arbitrary shell commands into a script that carries the account-wide
// Hetzner API token.
function shellEscapeDouble(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

interface TrainingCloudInitParams {
  botName: string;
  exchangeName: string;
  strategy: string;
  strategyCode: string;
  /** Every bot runs FreqAI — drives the training window, feature set, and downloaded history range. */
  freqaiConfig: FreqAIProfileConfig;
  /** Same auto/manual pairlist choice the live deploy gets — see buildPairlistConfig. */
  autoSelectCoins: boolean;
  pairWhitelist: string[];
  /** Same budget/risk settings the live deploy gets — backtesting (which is how FreqAI training runs) still exercises custom_stake_amount, so it needs a real custom_user_settings block too. */
  totalBudget: number;
  maxStakePercentage: number;
  /** Same snowball preference as the live deploy — kept consistent so a backtest previews the same sizing logic a real deploy would use. No tradableBalanceRatio here: this VM never receives real exchange credentials (see module doc below), so there's no live balance to protect. */
  autoCompound: boolean;
  /**
   * GET endpoint (/api/train/cloud/upload-url) the VM calls right before
   * uploading to mint a fresh signed Storage URL — minted just-in-time
   * rather than baked into cloud-init, since Supabase signed upload URLs
   * have a fixed ~2h expiry and training duration is unpredictable.
   */
  uploadUrlEndpoint: string;
  /** Full URL to POST /api/train/cloud/callback on this deployment. */
  callbackUrl: string;
  /** One-time bearer token identifying this specific TrainingJob to the callback route. */
  callbackToken: string;
  /** Needed so the VM can delete itself when done — see failsafe notes in lib/hetzner.ts callers. */
  hetznerApiToken: string;
  /** How much historical data to download. Defaults to a multiple of the profile's own training window, so there's always enough history to actually fill it. */
  timerangeDays?: number;
  /** Hard ceiling on the whole run; a `timeout`-triggered kill still fires the self-destruct trap. */
  maxRuntimeHours?: number;
}

// Builds a cloud-init script for an ephemeral training VM: installs Docker,
// writes the strategy source, downloads historical data, trains a FreqAI
// model via `backtesting` (freqtrade has no standalone "train" command —
// training happens as a side effect of backtesting with FreqAI enabled),
// uploads the single resulting .joblib to a pre-signed Supabase Storage
// URL, reports status back to our API, and unconditionally deletes itself.
// Callers should attach the "training" firewall profile (no inbound rules
// at all — this VM never needs to accept a connection).
//
// Deliberately does NOT take exchange API credentials: downloading history
// and backtesting only need public market data, so the user's real trading
// keys are never placed on this box.
export function buildFreqAITrainingCloudInit(params: TrainingCloudInitParams): string {
  const {
    botName,
    exchangeName,
    strategy,
    strategyCode,
    freqaiConfig,
    autoSelectCoins,
    pairWhitelist,
    totalBudget,
    maxStakePercentage,
    autoCompound,
    uploadUrlEndpoint,
    callbackUrl,
    callbackToken,
    hetznerApiToken,
    // Needs enough history to fill the training window plus backtest window
    // several times over, or FreqAI has nothing meaningful to train on —
    // AND, regardless of which timeframe the preset uses, enough extra at
    // the very front of the range for every indicator/feature to be fully
    // warmed up (startupCandleCount candles' worth, converted to real days
    // via the base timeframe) before FreqAI's own window even starts.
    // Insufficient warm-up produces partial-NaN features on the earliest
    // candles — a real source of spurious training noise, independent of
    // anything FreqAI itself learned, i.e. exactly what generously
    // over-provisioning history here is meant to rule out.
    timerangeDays = Math.max(
      90,
      (freqaiConfig.training.trainPeriodDays + freqaiConfig.training.backtestPeriodDays) * 4,
      freqaiConfig.training.trainPeriodDays +
        freqaiConfig.training.backtestPeriodDays +
        Math.ceil(
          (freqaiConfig.features.startupCandleCount * timeframeToMinutes(freqaiConfig.features.baseTimeframe)) /
            (60 * 24),
        ),
    ),
    maxRuntimeHours = 4,
  } = params;

  assertSafePythonIdentifier(strategy, "strategy");

  const safeBotName = botName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const timeframe = freqaiConfig.features.baseTimeframe;
  const pairlistConfig = buildPairlistConfig(autoSelectCoins, pairWhitelist);

  const today = new Date();
  const start = new Date(today.getTime() - timerangeDays * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const timerange = `${fmt(start)}-${fmt(today)}`;

  const trainingConfig = {
    stake_currency: STAKE_CURRENCY,
    stake_amount: "unlimited",
    // Same fee simulation value as the live deploy — FreqAI training runs
    // via `backtesting`, whose fee-aware profit/ROI numbers should reflect
    // the exchange the bot will actually be deployed to.
    fee: lookupExchangeFee(exchangeName),
    dry_run: true,
    dry_run_wallet: totalBudget,
    custom_user_settings: {
      total_budget: totalBudget,
      max_stake_pct: maxStakePercentage,
      auto_compound: autoCompound,
    },
    trading_mode: "spot",
    exchange: {
      name: exchangeName,
      key: "",
      secret: "",
      ccxt_config: {},
      ccxt_async_config: {},
      pair_whitelist: pairlistConfig.pair_whitelist,
      pair_blacklist: [],
    },
    pairlists: pairlistConfig.pairlists,
    freqaimodel: freqaiConfig.freqaiModel,
    ...(freqaiConfig.positionAdjustment?.enabled && {
      position_adjustment_enable: true,
      max_entry_position_adjustment: freqaiConfig.positionAdjustment.maxEntryPositionAdjustment,
    }),
    freqai: {
      enabled: true,
      identifier: `${safeBotName}-model`,
      train_period_days: freqaiConfig.training.trainPeriodDays,
      backtest_period_days: freqaiConfig.training.backtestPeriodDays,
      live_retrain_hours: freqaiConfig.training.liveRetrainHours,
      feature_parameters: {
        include_timeframes: freqaiConfig.features.includeTimeframes,
        indicator_periods_candles: freqaiConfig.features.indicatorPeriods,
      },
      data_split_parameters: { test_size: 0.25 },
    },
  };
  const configJson = JSON.stringify(trainingConfig, null, 2);

  // Every value that came from user-editable bot fields is escaped before
  // being embedded in a bash double-quoted assignment (see shellEscapeDouble
  // doc comment above); everything downstream references these as "$VAR",
  // never interpolated inline into a command. strategyCode itself is NOT
  // embedded in this shell script at all — it goes through write_files
  // below, which is inert plain-text, so it needs no shell escaping.
  const trainScript = `#!/bin/bash
set -uo pipefail

CALLBACK_URL="${shellEscapeDouble(callbackUrl)}"
UPLOAD_URL_ENDPOINT="${shellEscapeDouble(uploadUrlEndpoint)}"
CALLBACK_TOKEN="${shellEscapeDouble(callbackToken)}"
HETZNER_API_TOKEN="${shellEscapeDouble(hetznerApiToken)}"
STRATEGY="${shellEscapeDouble(strategy)}"
FREQAI_MODEL="${shellEscapeDouble(freqaiConfig.freqaiModel)}"
TIMERANGE="${shellEscapeDouble(timerange)}"

REPORTED=0

report_status() {
  local status="$1"
  local error_msg="\${2:-}"
  local payload
  payload=$(jq -n --arg status "$status" --arg err "$error_msg" \\
    '{status: $status, errorMessage: (if $err == "" then null else $err end)}')
  curl -fsS -m 30 -X POST "$CALLBACK_URL" \\
    -H "Authorization: Bearer $CALLBACK_TOKEN" \\
    -H "Content-Type: application/json" \\
    -d "$payload" || true
  REPORTED=1
}

# Fires on ANY script exit — success, a failed command, or a signal from the
# timeout wrapper below. This is the ONLY place that deletes the server,
# so self-destruct is guaranteed exactly once regardless of how the script
# ends. Layer 1 of 3 in the cost-safety design (see /api/train/cloud/callback
# and /api/train/cloud/reap for layers 2 and 3).
self_destruct() {
  local exit_code=$?
  if [ "$REPORTED" -eq 0 ]; then
    report_status "FAILED" "Training script exited unexpectedly (exit code $exit_code)"
  fi
  local server_id
  server_id=$(curl -fsS -m 10 -H "Metadata: true" http://169.254.169.254/hetzner/v1/metadata/instance-id || echo "")
  if [ -n "$server_id" ]; then
    curl -fsS -m 30 -X DELETE "https://api.hetzner.cloud/v1/servers/$server_id" \\
      -H "Authorization: Bearer $HETZNER_API_TOKEN" || true
  fi
}
trap self_destruct EXIT

fail() {
  echo "TRAINING FAILED: $1" >&2
  exit 1
}

mkdir -p /opt/freqtrade/user_data/models
cd /opt/freqtrade || fail "could not cd into /opt/freqtrade"

docker pull freqtradeorg/freqtrade:stable || fail "could not pull freqtrade image"

docker run --rm -v /opt/freqtrade/user_data:/freqtrade/user_data freqtradeorg/freqtrade:stable \\
  download-data --config user_data/config.json --timerange "$TIMERANGE" --timeframe "${shellEscapeDouble(timeframe)}" \\
  || fail "historical data download failed"

docker run --rm -v /opt/freqtrade/user_data:/freqtrade/user_data freqtradeorg/freqtrade:stable \\
  backtesting --config user_data/config.json --strategy "$STRATEGY" \\
  --freqaimodel "$FREQAI_MODEL" --timerange "$TIMERANGE" \\
  || fail "FreqAI training (via backtesting) failed"

MODEL_COUNT=$(find user_data/models -name '*.joblib' 2>/dev/null | wc -l)
if [ "$MODEL_COUNT" -ne 1 ]; then
  fail "expected exactly 1 .joblib model file, found $MODEL_COUNT"
fi
MODEL_FILE=$(find user_data/models -name '*.joblib')

# Minted just before uploading rather than baked into cloud-init, so a long
# training run can never race a signed URL's fixed expiry window.
UPLOAD_URL=$(curl -fsS -m 30 "$UPLOAD_URL_ENDPOINT" \\
  -H "Authorization: Bearer $CALLBACK_TOKEN" | jq -r '.uploadUrl')
[ -n "$UPLOAD_URL" ] && [ "$UPLOAD_URL" != "null" ] || fail "could not obtain a signed upload URL"

curl -fsS -m 1800 -X PUT "$UPLOAD_URL" \\
  -H "Content-Type: application/octet-stream" \\
  --data-binary "@$MODEL_FILE" \\
  || fail "model upload to storage failed"

report_status "COMPLETED"
exit 0
`;

  return `#cloud-config
package_update: true
packages:
  - docker.io
  - curl
  - jq

write_files:
${writeFilesBlock([
  { path: "/opt/freqtrade/user_data/config.json", content: configJson },
  { path: `/opt/freqtrade/user_data/strategies/${strategy}.py`, content: strategyCode },
  { path: "/opt/train.sh", content: trainScript, permissions: "0700" },
])}

runcmd:
  - systemctl enable docker
  - systemctl start docker
  - timeout --signal=TERM --kill-after=30s ${maxRuntimeHours}h /opt/train.sh
`;
}
