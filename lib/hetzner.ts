import { isSafePythonIdentifier } from "@/lib/strategy-validation";

const HETZNER_API_BASE = "https://api.hetzner.cloud/v1";

function requireHetznerToken(): string {
  const token = process.env.HETZNER_API_TOKEN;
  if (!token) throw new Error("HETZNER_API_TOKEN is not set");
  return token;
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

  const listRes = await fetch(`${HETZNER_API_BASE}/firewalls?name=${encodeURIComponent(name)}`, {
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

  const createRes = await fetch(`${HETZNER_API_BASE}/firewalls`, {
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

  const res = await fetch(`${HETZNER_API_BASE}/servers`, {
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

  const res = await fetch(`${HETZNER_API_BASE}/servers/${serverId}`, {
    method: "DELETE",
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

interface CloudInitParams {
  botName: string;
  exchangeName: string;
  exchangeApiKey: string;
  exchangeApiSecret: string;
  strategy: string;
  strategyCode: string;
  pairWhitelist: string[];
  stakeAmount: number;
  isPaperTrading: boolean;
  aiModelDownloadUrl?: string;
  apiServerUsername: string;
  apiServerPassword: string;
  apiServerJwtSecret: string;
}

// Builds a cloud-init script that installs Docker, writes the strategy
// source and Freqtrade config.json, (optionally) fetches the uploaded
// .joblib FreqAI model, and starts the container. Callers must attach the
// "live-trading" firewall profile (see createHetznerServer) since this
// opens the REST API on 0.0.0.0:8080 — that's why real, per-deployment
// api_server credentials are required params here rather than a constant.
export function buildFreqtradeCloudInit(params: CloudInitParams): string {
  const {
    botName,
    exchangeName,
    exchangeApiKey,
    exchangeApiSecret,
    strategy,
    strategyCode,
    pairWhitelist,
    stakeAmount,
    isPaperTrading,
    aiModelDownloadUrl,
    apiServerUsername,
    apiServerPassword,
    apiServerJwtSecret,
  } = params;

  assertSafePythonIdentifier(strategy, "strategy");
  const safeBotName = botName.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  const freqtradeConfig = {
    max_open_trades: 5,
    stake_currency: "USDT",
    stake_amount: stakeAmount,
    dry_run: isPaperTrading,
    dry_run_wallet: 1000,
    cancel_open_orders_on_exit: false,
    trading_mode: "spot",
    exchange: {
      name: exchangeName,
      key: exchangeApiKey,
      secret: exchangeApiSecret,
      ccxt_config: {},
      ccxt_async_config: {},
      pair_whitelist: pairWhitelist,
      pair_blacklist: [],
    },
    pairlists: [{ method: "StaticPairList" }],
    strategy,
    freqai: aiModelDownloadUrl
      ? {
          enabled: true,
          identifier: `${safeBotName}-model`,
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
  };

  const configJson = JSON.stringify(freqtradeConfig, null, 2);

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
  pairWhitelist: string[];
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
  freqaiModel?: string;
  timeframe?: string;
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
    pairWhitelist,
    uploadUrlEndpoint,
    callbackUrl,
    callbackToken,
    hetznerApiToken,
    freqaiModel = "LightGBMRegressor",
    timeframe = "5m",
    timerangeDays = 180,
    maxRuntimeHours = 4,
  } = params;

  assertSafePythonIdentifier(strategy, "strategy");

  const safeBotName = botName.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  const today = new Date();
  const start = new Date(today.getTime() - timerangeDays * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const timerange = `${fmt(start)}-${fmt(today)}`;

  const trainingConfig = {
    stake_currency: "USDT",
    stake_amount: "unlimited",
    dry_run: true,
    trading_mode: "spot",
    exchange: {
      name: exchangeName,
      key: "",
      secret: "",
      ccxt_config: {},
      ccxt_async_config: {},
      pair_whitelist: pairWhitelist,
      pair_blacklist: [],
    },
    pairlists: [{ method: "StaticPairList" }],
    freqai: {
      enabled: true,
      identifier: `${safeBotName}-model`,
      train_period_days: Math.min(30, Math.floor(timerangeDays / 2)),
      backtest_period_days: 7,
      feature_parameters: { include_timeframes: [timeframe] },
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
FREQAI_MODEL="${shellEscapeDouble(freqaiModel)}"
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
