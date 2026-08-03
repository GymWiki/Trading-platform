import { FlaskConical, Rocket, TrendingDown, TrendingUp } from "lucide-react";

export interface BotSummary {
  id: string;
  name: string;
  mode: "paper" | "live";
  roiPercent: number;
  /** Plain-language summary of the last trade — no "sell_reason: roi" jargon. */
  lastTradeSummary: string;
}

const MODE_COPY = {
  paper: { label: "Paper Trading", icon: FlaskConical },
  live: { label: "Live VPS", icon: Rocket },
} as const;

export function BotCard({ bot }: { bot: BotSummary }) {
  const isPositive = bot.roiPercent >= 0;
  const ModeIcon = MODE_COPY[bot.mode].icon;

  return (
    <article className="flex flex-col gap-4 rounded-2xl bg-panda-charcoal p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-panda-display font-semibold text-panda-cream">{bot.name}</h3>
          <span
            className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
              bot.mode === "live"
                ? "bg-panda-panic/15 text-panda-panic"
                : "bg-panda-charcoal-light text-panda-mist"
            }`}
          >
            <ModeIcon className="h-3 w-3" />
            {MODE_COPY[bot.mode].label}
          </span>
        </div>

        <div className={`flex items-center gap-1 font-panda-mono text-sm font-semibold tabular-nums ${isPositive ? "text-panda-bamboo" : "text-panda-panic"}`}>
          {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          {isPositive ? "+" : ""}
          {bot.roiPercent.toFixed(1)}%
        </div>
      </div>

      {/* Humanized last-trade line — the whole point being that a
          non-technical user reads this and understands it instantly. */}
      <p className="rounded-xl bg-panda-charcoal-light px-3.5 py-3 text-sm leading-relaxed text-panda-mist">
        {bot.lastTradeSummary}
      </p>
    </article>
  );
}
