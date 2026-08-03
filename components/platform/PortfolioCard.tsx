import { ArrowUpRight } from "lucide-react";

export interface PortfolioCardProps {
  /** Formatted for display — pass the real string once wired up ("€12.480,32"). */
  totalBalance: string;
  changePercent: number;
  changeLabel: string; // e.g. "afgelopen 24 uur"
}

// The prominent card the brief asks for — a hero balance figure plus a
// reserved chart well. Deliberately not a real chart: the curved path
// below is decorative only (a placeholder shape, not data), swap the
// whole <svg> block for e.g. Recharts once real history is wired in. No
// axes, no candles — just the one smooth "wealth" line the brief wants.
export function PortfolioCard({ totalBalance, changePercent, changeLabel }: PortfolioCardProps) {
  const isPositive = changePercent >= 0;

  return (
    <section className="rounded-3xl bg-panda-charcoal p-6 sm:p-8">
      <p className="font-panda-mono text-[11px] uppercase tracking-[0.2em] text-panda-mist">Totale waarde</p>

      <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
        <span className="font-panda-display text-4xl font-semibold tabular-nums text-panda-cream sm:text-5xl">
          {totalBalance}
        </span>
        <span
          className={`mb-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
            isPositive ? "bg-panda-bamboo/15 text-panda-bamboo" : "bg-panda-panic/15 text-panda-panic"
          }`}
        >
          <ArrowUpRight className={`h-3.5 w-3.5 ${isPositive ? "" : "rotate-90"}`} />
          {isPositive ? "+" : ""}
          {changePercent.toFixed(1)}%
        </span>
      </div>
      <p className="mt-1 text-xs text-panda-mist">{changeLabel}</p>

      {/* Chart well — replace the <svg> with a real chart component (kept
          to a single smooth line, per the brief: no candlesticks). */}
      <div className="mt-6 h-36 w-full overflow-hidden rounded-2xl bg-panda-charcoal-light sm:h-44">
        <svg viewBox="0 0 320 120" preserveAspectRatio="none" className="h-full w-full">
          <defs>
            <linearGradient id="portfolio-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7CC576" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#7CC576" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0,86 C24,90 40,60 64,64 C88,68 96,40 128,44 C160,48 168,20 200,24 C232,28 240,52 272,44 C296,38 304,18 320,14"
            fill="none"
            stroke="#7CC576"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path
            d="M0,86 C24,90 40,60 64,64 C88,68 96,40 128,44 C160,48 168,20 200,24 C232,28 240,52 272,44 C296,38 304,18 320,14 L320,120 L0,120 Z"
            fill="url(#portfolio-fill)"
          />
        </svg>
      </div>
    </section>
  );
}
