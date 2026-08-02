"use client";

import { useState } from "react";
import { Loader2, RefreshCw, Trash2, AlertTriangle } from "lucide-react";
import { EXCHANGE_PRESETS } from "@/lib/exchange-presets";
import type { PlatformWithBalance } from "@/lib/platforms";

interface PlatformCardProps {
  platform: PlatformWithBalance;
  onRefresh: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function PlatformCard({ platform, onRefresh, onDelete }: PlatformCardProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { connection, balance, balanceError } = platform;
  const preset = EXCHANGE_PRESETS.find((e) => e.id === connection.exchangeName);

  async function handleRefresh() {
    setError(null);
    setIsRefreshing(true);
    try {
      await onRefresh(connection.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`${preset?.label ?? connection.exchangeName} loskoppelen?`)) return;
    setError(null);
    setIsDeleting(true);
    try {
      await onDelete(connection.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setIsDeleting(false);
    }
  }

  return (
    <div className="card-surface flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${preset?.color ?? "bg-slate-500/20 text-slate-300"}`}
          >
            {preset?.monogram ?? "?"}
          </span>
          <div>
            <h3 className="font-semibold">{preset?.label ?? connection.exchangeName}</h3>
            <p className="text-xs text-slate-500">{preset?.feeNote}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting}
          className="shrink-0 rounded-md p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
          title="Platform loskoppelen"
        >
          {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>

      <div className="rounded-lg bg-background px-3 py-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">Beschikbare balans</span>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1 text-[11px] text-slate-500 transition hover:text-primary disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
            Ververs
          </button>
        </div>
        {balance ? (
          <p className="text-xl font-semibold text-primary">
            ${balance.amount.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}
            <span className="ml-1 text-xs font-normal text-slate-500">{balance.asset}</span>
          </p>
        ) : balanceError ? (
          <p className="flex items-center gap-1.5 text-xs text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Balans niet beschikbaar
          </p>
        ) : (
          <p className="text-xs text-slate-500">—</p>
        )}
        {balanceError && <p className="mt-1 truncate text-[11px] text-slate-600" title={balanceError}>{balanceError}</p>}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
