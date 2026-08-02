// Exchanges we support end-to-end (matches the ccxt/freqtrade exchange id
// used directly in the generated freqtrade config). Deliberately a closed
// list, not free text — an unsupported or misspelled exchange name would
// otherwise only surface as a cryptic failure deep in a cloud-init run;
// app/api/bots/route.ts re-validates against this same list server-side.
export interface ExchangePreset {
  id: string;
  label: string;
  description: string;
  /** Short monogram (1-2 letters) for the placeholder logo badge in ExchangeCombobox — swap for a real logo asset per exchange later. */
  monogram: string;
  /** Tailwind background class for the monogram badge, chosen per exchange for quick visual recognition. */
  color: string;
  /**
   * Standard (non-VIP, no token discount) retail spot maker/taker fee as a
   * decimal, e.g. 0.001 = 0.10%. Indicative, not a live quote — real fees
   * depend on 30d volume tier and token discounts (e.g. BNB on Binance) —
   * but good enough to warn a beginner off scalping on a high-fee exchange
   * before they lose money to round-trip costs. lib/hetzner.ts feeds
   * takerFee into the generated config.json's top-level "fee" key (freqtrade's
   * own fee-simulation value for backtests/dry-run) and every FreqAI
   * strategy's bot_start() (see lib/strategy-presets.ts) uses that same
   * number to keep profit targets safely above round-trip fee cost.
   */
  makerFee: number;
  takerFee: number;
  /** Rendered verbatim under the ExchangeCombobox once this exchange is selected. */
  feeNote: string;
}

export const EXCHANGE_PRESETS: ExchangePreset[] = [
  {
    id: "binance",
    label: "Binance",
    description: "Grootste exchange, ruime paren-selectie",
    monogram: "BN",
    color: "bg-amber-500/20 text-amber-300",
    makerFee: 0.001,
    takerFee: 0.001,
    feeNote: "Kosten per trade: ~0.10%. Perfect voor snelle AI Scalping.",
  },
  {
    id: "kraken",
    label: "Kraken",
    description: "Betrouwbaar, sterk in EUR-paren",
    monogram: "KR",
    color: "bg-violet-500/20 text-violet-300",
    makerFee: 0.0025,
    takerFee: 0.004,
    feeNote: "Kosten per trade: ~0.25% / 0.40%. Minder geschikt voor kleine scalping-marges; AI Trend Catcher aanbevolen.",
  },
  {
    id: "kucoin",
    label: "KuCoin",
    description: "Groot aanbod aan altcoins",
    monogram: "KC",
    color: "bg-emerald-500/20 text-emerald-300",
    makerFee: 0.001,
    takerFee: 0.001,
    feeNote: "Kosten per trade: ~0.10%. Geschikt voor AI Scalping.",
  },
  {
    id: "okx",
    label: "OKX",
    description: "Diepe liquiditeit, veel derivaten",
    monogram: "OK",
    color: "bg-slate-400/20 text-slate-200",
    makerFee: 0.0008,
    takerFee: 0.001,
    feeNote: "Kosten per trade: ~0.08% / 0.10%. Geschikt voor AI Scalping.",
  },
  {
    id: "bybit",
    label: "Bybit",
    description: "Populair voor spot en futures",
    monogram: "BY",
    color: "bg-yellow-500/20 text-yellow-300",
    makerFee: 0.001,
    takerFee: 0.001,
    feeNote: "Kosten per trade: ~0.10%. Geschikt voor AI Scalping.",
  },
  {
    id: "gate",
    label: "Gate.io",
    description: "Zeer brede altcoin-selectie",
    monogram: "GT",
    color: "bg-sky-500/20 text-sky-300",
    makerFee: 0.002,
    takerFee: 0.002,
    feeNote: "Kosten per trade: ~0.20%. Redelijk geschikt voor gematigde AI-strategieën zoals AI Dynamic DCA.",
  },
  {
    id: "bitpanda",
    label: "Bitpanda",
    description: "EU-gereguleerd, beginnersvriendelijk",
    monogram: "BP",
    color: "bg-emerald-500/20 text-emerald-300",
    makerFee: 0.001,
    takerFee: 0.0015,
    feeNote: "Kosten per trade: ~0.10% / 0.15%. Redelijk geschikt voor AI Scalping.",
  },
  {
    id: "htx",
    label: "HTX",
    description: "Voorheen Huobi, groot Aziatisch volume",
    monogram: "HT",
    color: "bg-blue-500/20 text-blue-300",
    makerFee: 0.002,
    takerFee: 0.002,
    feeNote: "Kosten per trade: ~0.20%. Redelijk geschikt voor gematigde AI-strategieën.",
  },
  {
    id: "bitvavo",
    label: "Bitvavo",
    description: "Nederlandse exchange, lage fees in EUR",
    monogram: "BV",
    color: "bg-orange-500/20 text-orange-300",
    makerFee: 0.0015,
    takerFee: 0.0025,
    feeNote: "Kosten per trade: ~0.15% / 0.25%. Minder ideaal voor scalping; AI Dynamic DCA of AI Trend Catcher aanbevolen.",
  },
  {
    id: "bitget",
    label: "Bitget",
    description: "Sterk in copy trading en futures",
    monogram: "BG",
    color: "bg-teal-500/20 text-teal-300",
    makerFee: 0.001,
    takerFee: 0.001,
    feeNote: "Kosten per trade: ~0.10%. Geschikt voor AI Scalping.",
  },
  {
    id: "mexc",
    label: "MEXC",
    description: "Snelle listings, veel nieuwe altcoins",
    monogram: "MX",
    color: "bg-blue-500/20 text-blue-300",
    makerFee: 0,
    takerFee: 0.001,
    feeNote: "Kosten per trade: ~0% / 0.10%. Zeer geschikt voor AI Scalping.",
  },
  {
    id: "bingx",
    label: "BingX",
    description: "Social/copy trading-gericht",
    monogram: "BX",
    color: "bg-indigo-500/20 text-indigo-300",
    makerFee: 0.001,
    takerFee: 0.001,
    feeNote: "Kosten per trade: ~0.10%. Geschikt voor AI Scalping.",
  },
];
