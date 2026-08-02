"use client";

import { useId, useState, type FormEvent } from "react";
import { Loader2, Plus, X } from "lucide-react";
import type { BotConfigurationDTO } from "@/lib/types";
import { ExchangeCombobox } from "@/components/ui/ExchangeCombobox";
import { InfoTooltip } from "@/components/ui/Tooltip";
import { StrategyPicker } from "@/components/ui/StrategyPicker";
import { PairSelector } from "@/components/ui/PairSelector";
import { BudgetSlider } from "@/components/ui/BudgetSlider";
import { Switch } from "@/components/ui/Switch";
import { EXCHANGE_PRESETS } from "@/lib/exchange-presets";
import { STRATEGY_PRESETS, type StrategyPreset } from "@/lib/strategy-presets";

interface NewBotDialogProps {
  onCreated: (bot: BotConfigurationDTO) => void;
}

const DEFAULT_STRATEGY = STRATEGY_PRESETS[0];

const EMPTY_FORM = {
  botName: "",
  exchangeName: EXCHANGE_PRESETS[0].id,
  exchangeApiKey: "",
  exchangeApiSecret: "",
  strategyId: DEFAULT_STRATEGY.id,
  autoSelectCoins: true,
  pairs: ["BTC/USDT", "ETH/USDT"] as string[],
  totalBudget: 500,
  maxStakePercentage: 20,
};

export function NewBotDialog({ onCreated }: NewBotDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedStrategy: StrategyPreset =
    STRATEGY_PRESETS.find((s) => s.id === form.strategyId) ?? DEFAULT_STRATEGY;
  const selectedExchange = EXCHANGE_PRESETS.find((e) => e.id === form.exchangeName);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.autoSelectCoins && form.pairs.length === 0) {
      setError("Kies minstens 1 handelspaar, of zet automatische coin-selectie aan.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botName: form.botName,
          exchangeName: form.exchangeName,
          exchangeApiKey: form.exchangeApiKey,
          exchangeApiSecret: form.exchangeApiSecret,
          strategy: selectedStrategy.className,
          strategyCode: selectedStrategy.code,
          freqaiConfig: selectedStrategy.freqaiConfig,
          autoSelectCoins: form.autoSelectCoins,
          pairWhitelist: form.autoSelectCoins ? undefined : form.pairs.join(","),
          totalBudget: form.totalBudget,
          maxStakePercentage: form.maxStakePercentage,
          isPaperTrading: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create bot");
      onCreated(data.bot);
      setForm(EMPTY_FORM);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create bot");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-background transition hover:bg-primary-hover"
      >
        <Plus className="h-4 w-4" />
        New Bot
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card-surface flex max-h-[90vh] w-full max-w-lg flex-col p-6">
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <div>
            <h2 className="font-semibold">Nieuwe AI-bot instellen</h2>
            <p className="text-xs text-slate-400">
              Elke bot handelt met FreqAI. Geen technische kennis nodig — kies gewoon het AI-gedrag dat bij je past.
            </p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <Field label="Botnaam">
              <input
                required
                value={form.botName}
                onChange={(e) => setForm({ ...form, botName: e.target.value })}
                className="input"
                placeholder="Mijn eerste bot"
              />
            </Field>

            <FieldGroup label="Exchange">
              <ExchangeCombobox
                value={form.exchangeName}
                onChange={(exchangeName) => setForm({ ...form, exchangeName })}
                aria-label="Exchange"
              />
            </FieldGroup>

            <Field
              label="API-key"
              tooltip="Te vinden in de instellingen van je exchange-account. Geef deze key alleen trading-rechten, nooit opname-rechten (withdraw)."
            >
              <input
                required
                type="password"
                autoComplete="off"
                value={form.exchangeApiKey}
                onChange={(e) => setForm({ ...form, exchangeApiKey: e.target.value })}
                className="input"
                placeholder="••••••••••••"
              />
            </Field>

            <Field
              label="API-secret"
              tooltip="Het bijbehorende geheime deel van je API-key. Wordt versleuteld opgeslagen en nooit getoond."
            >
              <input
                required
                type="password"
                autoComplete="off"
                value={form.exchangeApiSecret}
                onChange={(e) => setForm({ ...form, exchangeApiSecret: e.target.value })}
                className="input"
                placeholder="••••••••••••"
              />
            </Field>

            <FieldGroup label="AI-gedrag">
              <StrategyPicker
                selectedId={form.strategyId}
                onSelect={(preset) => setForm({ ...form, strategyId: preset.id })}
              />
            </FieldGroup>

            <FieldGroup label="Handelsparen">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
                  <span id="auto-select-coins-label" className="text-xs font-medium text-slate-200">
                    Laat FreqAI automatisch de beste coins kiezen{" "}
                    <span className="text-primary">(Aanbevolen)</span>
                  </span>
                  <Switch
                    checked={form.autoSelectCoins}
                    onChange={(autoSelectCoins) => setForm({ ...form, autoSelectCoins })}
                    aria-labelledby="auto-select-coins-label"
                  />
                </div>

                {form.autoSelectCoins ? (
                  <p className="rounded-lg bg-background px-3 py-2 text-[11px] leading-relaxed text-slate-400">
                    De bot scant dynamisch de top-liquide markten op{" "}
                    <span className="text-slate-300">{selectedExchange?.label ?? "je exchange"}</span> en laat de
                    AI handelen waar de kansen het grootst zijn.
                  </p>
                ) : (
                  <PairSelector selected={form.pairs} onChange={(pairs) => setForm({ ...form, pairs })} />
                )}
              </div>
            </FieldGroup>

            <FieldGroup
              label="Totaal Bot Budget (USDT)"
              tooltip="Het totale bedrag dat de bot mag gebruiken. Bij paper trading wordt hier niet écht mee gehandeld."
            >
              <BudgetSlider
                totalBudget={form.totalBudget}
                maxStakePercentage={form.maxStakePercentage}
                onBudgetChange={(totalBudget) => setForm({ ...form, totalBudget })}
                onPercentageChange={(maxStakePercentage) => setForm({ ...form, maxStakePercentage })}
              />
            </FieldGroup>

            {error && (
              <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-4 flex w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-background transition hover:bg-primary-hover disabled:opacity-50"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Bot aanmaken
          </button>
        </form>
      </div>
    </div>
  );
}

// For a field with exactly one native form control — a real <label>
// wrapper gives correct implicit association with no downsides.
function Field({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-400">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      {children}
    </label>
  );
}

// For a field built from a composite widget with multiple interactive
// descendants (Select, StrategyPicker, PairSelector). Wrapping several
// buttons in a native <label> is a real bug, not just a style nit: once a
// click handler mutates the DOM (e.g. removing the first button), the
// browser's own label-click-forwarding step re-evaluates "the label's
// control" against the *new* DOM and fires a second, spurious click on
// whatever button ends up first — observed here as removing one selected
// pair silently removing a second one too. A plain group with
// aria-labelledby gives the same accessible name without that behavior.
function FieldGroup({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  const labelId = useId();
  return (
    <div>
      <span id={labelId} className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-400">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      <div role="group" aria-labelledby={labelId}>
        {children}
      </div>
    </div>
  );
}
