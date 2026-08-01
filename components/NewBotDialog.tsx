"use client";

import { useState, type FormEvent } from "react";
import { Loader2, Plus, X } from "lucide-react";
import type { BotConfigurationDTO } from "@/lib/types";

interface NewBotDialogProps {
  onCreated: (bot: BotConfigurationDTO) => void;
}

const EMPTY_FORM = {
  botName: "",
  exchangeName: "binance",
  exchangeApiKey: "",
  exchangeApiSecret: "",
  strategy: "SampleStrategy",
  pairWhitelist: "BTC/USDT,ETH/USDT",
  stakeAmount: 50,
};

export function NewBotDialog({ onCreated }: NewBotDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, isPaperTrading: true }),
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
      <div className="card-surface w-full max-w-md p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">New Bot Configuration</h2>
          <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Bot name">
            <input
              required
              value={form.botName}
              onChange={(e) => setForm({ ...form, botName: e.target.value })}
              className="input"
              placeholder="btc-scalper"
            />
          </Field>
          <Field label="Exchange">
            <input
              required
              value={form.exchangeName}
              onChange={(e) => setForm({ ...form, exchangeName: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Exchange API key">
            <input
              required
              type="password"
              value={form.exchangeApiKey}
              onChange={(e) => setForm({ ...form, exchangeApiKey: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Exchange API secret">
            <input
              required
              type="password"
              value={form.exchangeApiSecret}
              onChange={(e) => setForm({ ...form, exchangeApiSecret: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Strategy class name">
            <input
              required
              value={form.strategy}
              onChange={(e) => setForm({ ...form, strategy: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Pair whitelist (comma separated)">
            <input
              required
              value={form.pairWhitelist}
              onChange={(e) => setForm({ ...form, pairWhitelist: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Stake amount (USDT)">
            <input
              required
              type="number"
              min={1}
              step="any"
              value={form.stakeAmount}
              onChange={(e) => setForm({ ...form, stakeAmount: Number(e.target.value) })}
              className="input"
            />
          </Field>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-background transition hover:bg-primary-hover disabled:opacity-50"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Create bot
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {children}
    </label>
  );
}
