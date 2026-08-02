// Popular pairs offered as clickable chips instead of a free-text field —
// removes both the typo risk (an unsupported pair fails silently deep in
// freqtrade's data download step) and the need to know exchange-specific
// pair syntax up front.
export interface PairPreset {
  symbol: string;
  label: string;
}

export const PAIR_PRESETS: PairPreset[] = [
  { symbol: "BTC/USDT", label: "Bitcoin" },
  { symbol: "ETH/USDT", label: "Ethereum" },
  { symbol: "SOL/USDT", label: "Solana" },
  { symbol: "BNB/USDT", label: "BNB" },
  { symbol: "XRP/USDT", label: "XRP" },
  { symbol: "ADA/USDT", label: "Cardano" },
  { symbol: "DOGE/USDT", label: "Dogecoin" },
  { symbol: "MATIC/USDT", label: "Polygon" },
  { symbol: "AVAX/USDT", label: "Avalanche" },
  { symbol: "LINK/USDT", label: "Chainlink" },
  { symbol: "DOT/USDT", label: "Polkadot" },
  { symbol: "LTC/USDT", label: "Litecoin" },
];
