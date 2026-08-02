"use client";

import { Zap, Repeat, TrendingUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { STRATEGY_PRESETS, type StrategyPreset } from "@/lib/strategy-presets";

const ICONS: Record<string, LucideIcon> = {
  "ai-smart-scalper": Zap,
  "ai-dynamic-dca": Repeat,
  "ai-trend-catcher": TrendingUp,
};

const RISK_STYLES: Record<StrategyPreset["risk"], string> = {
  Laag: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  Gemiddeld: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  Hoog: "bg-red-500/10 text-red-300 border-red-500/30",
};

interface StrategyPickerProps {
  selectedId: string;
  onSelect: (preset: StrategyPreset) => void;
}

// A visual, jargon-free replacement for a raw "strategy class name" text
// field. The user only ever sees a title + plain-language description;
// preset.className/preset.code/preset.freqaiConfig (the actual technical
// wiring the backend needs) travel along automatically once a card is
// picked. Every card here runs on FreqAI — this picker chooses the AI's
// *behavior*, not whether AI is involved at all.
export function StrategyPicker({ selectedId, onSelect }: StrategyPickerProps) {
  return (
    <div role="radiogroup" aria-label="Kies het AI-gedrag van je bot" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {STRATEGY_PRESETS.map((preset) => {
        const Icon = ICONS[preset.id] ?? Zap;
        const checked = preset.id === selectedId;
        return (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onSelect(preset)}
            className={cn(
              "flex flex-col gap-2 rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              checked
                ? "border-primary bg-primary/10"
                : "border-border bg-background hover:border-primary/40",
            )}
          >
            <div className="flex items-center justify-between">
              <Icon className={cn("h-5 w-5", checked ? "text-primary" : "text-slate-400")} />
              <span
                className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                  RISK_STYLES[preset.risk],
                )}
              >
                {preset.risk} risico
              </span>
            </div>
            <div>
              <div className={cn("text-sm font-semibold", checked ? "text-primary" : "text-slate-100")}>
                {preset.title}
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{preset.description}</p>
            </div>
            <span className="text-[11px] text-slate-500">Timeframe: {preset.timeframe}</span>
          </button>
        );
      })}
    </div>
  );
}
