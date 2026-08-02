"use client";

import { useId, useState, type FormEvent } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { ExchangeCombobox } from "@/components/ui/ExchangeCombobox";
import { InfoTooltip } from "@/components/ui/Tooltip";
import { EXCHANGE_PRESETS } from "@/lib/exchange-presets";
import type { PlatformWithBalance } from "@/lib/platforms";
import { apiFetch, toErrorMessage } from "@/lib/api-client";

interface AddPlatformDialogProps {
  connectedExchangeIds: string[];
  onAdded: (platform: PlatformWithBalance) => void;
}

const EMPTY_FORM = { exchangeName: EXCHANGE_PRESETS[0].id, apiKey: "", apiSecret: "" };

// Mirrors NewBotDialog's modal shell/Field-FieldGroup pattern (see that
// file for why composite widgets use a group + aria-labelledby instead of
// a native <label>) so adding a platform feels like the same product as
// adding a bot, not a bolted-on admin screen.
export function AddPlatformDialog({ connectedExchangeIds, onAdded }: AddPlatformDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();

  const selectedExchange = EXCHANGE_PRESETS.find((e) => e.id === form.exchangeName);
  const alreadyConnected = connectedExchangeIds.includes(form.exchangeName);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (alreadyConnected) {
      setError("Dit platform is al gekoppeld.");
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await apiFetch<{ platform: PlatformWithBalance }>("/api/platforms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      onAdded(data.platform);
      setForm(EMPTY_FORM);
      setOpen(false);
    } catch (err) {
      setError(toErrorMessage(err, "Failed to add platform"));
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
        Platform koppelen
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card-surface flex max-h-[90vh] w-full max-w-md flex-col p-6">
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <div>
            <h2 className="font-semibold">Platform koppelen</h2>
            <p className="text-xs text-slate-400">Eén keer koppelen — elke bot kan dit account daarna gebruiken.</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div>
              <span id={labelId} className="mb-1 block text-xs font-medium text-slate-400">
                Exchange
              </span>
              <div role="group" aria-labelledby={labelId}>
                <ExchangeCombobox
                  value={form.exchangeName}
                  onChange={(exchangeName) => setForm({ ...form, exchangeName })}
                  aria-label="Exchange"
                />
              </div>
              {selectedExchange && (
                <p className="mt-2 rounded-lg bg-background px-3 py-2 text-[11px] leading-relaxed text-slate-400">
                  {selectedExchange.feeNote}
                </p>
              )}
              {alreadyConnected && (
                <p className="mt-2 text-[11px] text-amber-400">Dit platform is al gekoppeld aan je account.</p>
              )}
            </div>

            <label className="block">
              <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-400">
                API-key
                <InfoTooltip text="Te vinden in de instellingen van je exchange-account. Geef deze key alleen trading-rechten, nooit opname-rechten (withdraw)." />
              </span>
              <input
                required
                type="password"
                autoComplete="off"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                className="input"
                placeholder="••••••••••••"
              />
            </label>

            <label className="block">
              <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-400">
                API-secret
                <InfoTooltip text="Het bijbehorende geheime deel van je API-key. Wordt versleuteld opgeslagen en nooit getoond." />
              </span>
              <input
                required
                type="password"
                autoComplete="off"
                value={form.apiSecret}
                onChange={(e) => setForm({ ...form, apiSecret: e.target.value })}
                className="input"
                placeholder="••••••••••••"
              />
            </label>

            {error && (
              <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting || alreadyConnected}
            className="mt-4 flex w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-background transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Platform koppelen
          </button>
        </form>
      </div>
    </div>
  );
}
