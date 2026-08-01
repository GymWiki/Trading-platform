"use client";

import { useRef, useState } from "react";
import { Download, Rocket, Upload, Loader2, CheckCircle2, Trash2 } from "lucide-react";
import type { BotConfigurationDTO } from "@/lib/types";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PaperLiveToggle } from "@/components/ui/Toggle";

interface BotCardProps {
  bot: BotConfigurationDTO;
  onUpdate: (bot: BotConfigurationDTO) => void;
  onDelete: (id: string) => void;
}

export function BotCard({ bot, onUpdate, onDelete }: BotCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isTogglingMode, setIsTogglingMode] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle(isPaperTrading: boolean) {
    setError(null);
    setIsTogglingMode(true);
    try {
      const res = await fetch(`/api/bots/${bot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPaperTrading }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update bot");
      onUpdate(data.bot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update bot");
    } finally {
      setIsTogglingMode(false);
    }
  }

  async function handleFileSelected(file: File) {
    setError(null);
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("botId", bot.id);
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      onUpdate({ ...bot, aiModelPath: data.aiModelPath });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleDownloadConfig() {
    const config = {
      bot_name: bot.botName,
      exchange: bot.exchangeName,
      strategy: bot.strategy,
      pair_whitelist: bot.pairWhitelist.split(",").map((p) => p.trim()),
      stake_amount: bot.stakeAmount,
      dry_run: bot.isPaperTrading,
      ai_model_path: bot.aiModelPath ?? null,
      note: "Fill in your exchange API key/secret locally — they are never exported from the dashboard.",
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${bot.botName.replace(/\s+/g, "-").toLowerCase()}-config.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDeploy() {
    setError(null);
    setIsDeploying(true);
    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId: bot.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Deploy failed");

      if (data.requiresCheckout) {
        window.location.href = data.checkoutUrl;
        return;
      }
      onUpdate(data.bot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      setIsDeploying(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Remove ${bot.botName}? This cannot be undone.`)) return;
    const res = await fetch(`/api/bots/${bot.id}`, { method: "DELETE" });
    if (res.ok) onDelete(bot.id);
  }

  return (
    <div className="card-surface flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{bot.botName}</h3>
          <p className="text-xs text-slate-400">
            {bot.exchangeName} &middot; {bot.strategy}
          </p>
        </div>
        <StatusBadge status={bot.deploymentStatus} />
      </div>

      <PaperLiveToggle
        isPaperTrading={bot.isPaperTrading}
        onChange={handleToggle}
        disabled={isTogglingMode}
      />

      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".joblib"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelected(file);
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-primary hover:text-primary disabled:opacity-50"
        >
          {isUploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : bot.aiModelPath ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          {bot.aiModelPath ? "Model uploaded — replace" : "Upload FreqAI model (.joblib)"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
        <button
          type="button"
          onClick={handleDownloadConfig}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-primary hover:text-primary"
        >
          <Download className="h-3.5 w-3.5" />
          Local Config
        </button>
        <button
          type="button"
          onClick={handleDeploy}
          disabled={isDeploying || bot.deploymentStatus === "VPS_ACTIVE"}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-background transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isDeploying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Rocket className="h-3.5 w-3.5" />
          )}
          {bot.deploymentStatus === "VPS_ACTIVE" ? "Deployed" : "Deploy to Cloud"}
        </button>
      </div>

      <button
        type="button"
        onClick={handleDelete}
        className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500 transition hover:text-red-400"
      >
        <Trash2 className="h-3 w-3" />
        Remove bot
      </button>
    </div>
  );
}
