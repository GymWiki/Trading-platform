"use client";

interface BudgetSliderProps {
  totalBudget: number;
  maxStakePercentage: number;
  onBudgetChange: (value: number) => void;
  onPercentageChange: (value: number) => void;
}

// Replaces the old single "stake amount per trade" text field. The user
// sets one number they actually think in — the total budget this bot may
// use — and a slider for what fraction of it a single trade may ever
// claim. The €-per-trade figure is display-only: the real ceiling is
// enforced server-side by custom_stake_amount in the deployed strategy
// code (see lib/strategy-presets.ts), reading these two numbers back out
// of custom_user_settings in config.json (see lib/hetzner.ts).
export function BudgetSlider({ totalBudget, maxStakePercentage, onBudgetChange, onPercentageChange }: BudgetSliderProps) {
  const maxStakePerTrade = (totalBudget * maxStakePercentage) / 100;

  return (
    <div className="space-y-3">
      <input
        required
        type="number"
        min={10}
        step="any"
        value={totalBudget}
        onChange={(e) => onBudgetChange(Number(e.target.value))}
        className="input"
        placeholder="500"
      />

      <div>
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Max inzet per trade</span>
          <span className="font-mono font-semibold text-primary">{maxStakePercentage}%</span>
        </div>
        <input
          type="range"
          min={10}
          max={100}
          step={1}
          value={maxStakePercentage}
          onChange={(e) => onPercentageChange(Number(e.target.value))}
          className="mt-1.5 w-full accent-primary"
          aria-label="Max inzet per trade als percentage van het budget"
        />
        <p className="mt-1.5 rounded-lg bg-background px-3 py-2 text-[11px] leading-relaxed text-slate-400">
          De bot zet maximaal{" "}
          <span className="font-semibold text-primary">
            €{maxStakePerTrade.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}
          </span>{" "}
          in per trade bij een zeer zekere AI-voorspelling.
        </p>
      </div>
    </div>
  );
}
