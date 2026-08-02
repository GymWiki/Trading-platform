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
}

export const EXCHANGE_PRESETS: ExchangePreset[] = [
  { id: "binance", label: "Binance", description: "Grootste exchange, ruime paren-selectie", monogram: "BN", color: "bg-amber-500/20 text-amber-300" },
  { id: "kraken", label: "Kraken", description: "Betrouwbaar, sterk in EUR-paren", monogram: "KR", color: "bg-violet-500/20 text-violet-300" },
  { id: "kucoin", label: "KuCoin", description: "Groot aanbod aan altcoins", monogram: "KC", color: "bg-emerald-500/20 text-emerald-300" },
  { id: "okx", label: "OKX", description: "Diepe liquiditeit, veel derivaten", monogram: "OK", color: "bg-slate-400/20 text-slate-200" },
  { id: "bybit", label: "Bybit", description: "Populair voor spot en futures", monogram: "BY", color: "bg-yellow-500/20 text-yellow-300" },
  { id: "gate", label: "Gate.io", description: "Zeer brede altcoin-selectie", monogram: "GT", color: "bg-sky-500/20 text-sky-300" },
  { id: "bitpanda", label: "Bitpanda", description: "EU-gereguleerd, beginnersvriendelijk", monogram: "BP", color: "bg-emerald-500/20 text-emerald-300" },
  { id: "htx", label: "HTX", description: "Voorheen Huobi, groot Aziatisch volume", monogram: "HT", color: "bg-blue-500/20 text-blue-300" },
  { id: "bitvavo", label: "Bitvavo", description: "Nederlandse exchange, lage fees in EUR", monogram: "BV", color: "bg-orange-500/20 text-orange-300" },
  { id: "bitget", label: "Bitget", description: "Sterk in copy trading en futures", monogram: "BG", color: "bg-teal-500/20 text-teal-300" },
  { id: "mexc", label: "MEXC", description: "Snelle listings, veel nieuwe altcoins", monogram: "MX", color: "bg-blue-500/20 text-blue-300" },
  { id: "bingx", label: "BingX", description: "Social/copy trading-gericht", monogram: "BX", color: "bg-indigo-500/20 text-indigo-300" },
];
