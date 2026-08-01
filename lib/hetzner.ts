const HETZNER_API_BASE = "https://api.hetzner.cloud/v1";

interface CreateServerParams {
  name: string;
  cloudInit: string;
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
}: CreateServerParams): Promise<HetznerServerResponse> {
  const token = process.env.HETZNER_API_TOKEN;
  if (!token) throw new Error("HETZNER_API_TOKEN is not set");

  const res = await fetch(`${HETZNER_API_BASE}/servers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      server_type: process.env.HETZNER_SERVER_TYPE || "cx11",
      image: process.env.HETZNER_IMAGE || "ubuntu-24.04",
      location: process.env.HETZNER_LOCATION || "nbg1",
      user_data: cloudInit,
      ssh_keys: process.env.HETZNER_SSH_KEY_ID ? [process.env.HETZNER_SSH_KEY_ID] : undefined,
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
  const token = process.env.HETZNER_API_TOKEN;
  if (!token) throw new Error("HETZNER_API_TOKEN is not set");

  const res = await fetch(`${HETZNER_API_BASE}/servers/${serverId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok && res.status !== 404) {
    const errorBody = await res.text();
    throw new Error(`Hetzner API error (${res.status}): ${errorBody}`);
  }
}

interface CloudInitParams {
  botName: string;
  exchangeName: string;
  exchangeApiKey: string;
  exchangeApiSecret: string;
  strategy: string;
  pairWhitelist: string[];
  stakeAmount: number;
  isPaperTrading: boolean;
  aiModelDownloadUrl?: string;
}

// Builds a cloud-init script that installs Docker, writes a Freqtrade config.json,
// (optionally) fetches the uploaded .joblib FreqAI model, and starts the container.
export function buildFreqtradeCloudInit(params: CloudInitParams): string {
  const {
    botName,
    exchangeName,
    exchangeApiKey,
    exchangeApiSecret,
    strategy,
    pairWhitelist,
    stakeAmount,
    isPaperTrading,
    aiModelDownloadUrl,
  } = params;

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
          identifier: `${botName}-model`,
        }
      : undefined,
    api_server: {
      enabled: true,
      listen_ip_address: "0.0.0.0",
      listen_port: 8080,
      jwt_secret_key: "CHANGE_ME_ON_DEPLOY",
      username: "freqtrader",
      password: "CHANGE_ME_ON_DEPLOY",
    },
  };

  const configJson = JSON.stringify(freqtradeConfig, null, 2);

  const fetchModelStep = aiModelDownloadUrl
    ? `
mkdir -p /opt/freqtrade/user_data/models
curl -fsSL "${aiModelDownloadUrl}" -o /opt/freqtrade/user_data/models/${botName}-model.joblib
`
    : "";

  return `#cloud-config
package_update: true
packages:
  - docker.io
  - docker-compose-plugin

runcmd:
  - systemctl enable docker
  - systemctl start docker
  - mkdir -p /opt/freqtrade/user_data
  - |
    cat > /opt/freqtrade/user_data/config.json << 'EOF'
    ${configJson}
    EOF
  - |
    bash -c '${fetchModelStep.trim().replace(/\n/g, "; ")}'
  - >
    docker run -d --name ${botName}
    --restart unless-stopped
    -v /opt/freqtrade/user_data:/freqtrade/user_data
    -p 8080:8080
    freqtradeorg/freqtrade:stable
    trade --config /freqtrade/user_data/config.json --strategy ${strategy}
`;
}
