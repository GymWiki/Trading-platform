// Exchanges we support end-to-end (matches the ccxt/freqtrade exchange id
// used directly in the generated freqtrade config). Deliberately a closed
// list, not free text — an unsupported or misspelled exchange name would
// otherwise only surface as a cryptic failure deep in a cloud-init run.
export interface ExchangePreset {
  id: string;
  label: string;
  description: string;
}

export const EXCHANGE_PRESETS: ExchangePreset[] = [
  { id: "binance", label: "Binance", description: "Grootste exchange, ruime paren-selectie" },
  { id: "kraken", label: "Kraken", description: "Betrouwbaar, sterk in EUR-paren" },
  { id: "kucoin", label: "KuCoin", description: "Groot aanbod aan altcoins" },
];
