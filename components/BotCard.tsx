"use client";

import { useRef, useState } from "react";
import { Download, Rocket, Upload, Loader2, CheckCircle2, Trash2, Cloud, Laptop, KeyRound, Copy, Check, Zap } from "lucide-react";
import type { BotConfigurationDTO, TrainingStatus } from "@/lib/types";
import { StatusBadge, TrainingStatusBadge } from "@/components/ui/StatusBadge";
import { TrainingModeToggle } from "@/components/ui/Toggle";
import { GoLiveModal } from "@/components/GoLiveModal";
import { DEFAULT_PAPER_TOTAL_BUDGET, DEFAULT_PAPER_MAX_STAKE_PERCENTAGE } from "@/lib/paper-trading-defaults";
import { isTauri } from "@/lib/tauri";
import { apiFetch, toErrorMessage } from "@/lib/api-client";

interface BotCardProps {
  bot: BotConfigurationDTO;
  onUpdate: (bot: BotConfigurationDTO) => void;
  onDelete: (id: string) => void;
}

export function BotCard({ bot, onUpdate, onDelete }: BotCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isTrainingLocally, setIsTrainingLocally] = useState(false);
  const [isStartingCloudTraining, setIsStartingCloudTraining] = useState(false);
  const [isRevealingCredentials, setIsRevealingCredentials] = useState(false);
  const [apiCredentials, setApiCredentials] = useState<{ username: string; password: string } | null>(null);
  const [copiedField, setCopiedField] = useState<"username" | "password" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGoLiveOpen, setIsGoLiveOpen] = useState(false);
  const [isTogglingTrainingMode, setIsTogglingTrainingMode] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const jobActive = bot.latestTrainingJob?.status === "QUEUED" || bot.latestTrainingJob?.status === "TRAINING";
  const canGoLive = bot.status === "TRAINING_PAPER_TRADE" && bot.deploymentStatus === "VPS_ACTIVE";

  async function handleTrainingModeChange(trainingMode: "LOCAL" | "CLOUD") {
    setError(null);
    setIsTogglingTrainingMode(true);
    try {
      const data = await apiFetch<{ bot: BotConfigurationDTO }>(`/api/bots/${bot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trainingMode }),
      });
      onUpdate(data.bot);
    } catch (err) {
      setError(toErrorMessage(err, "Failed to update training mode"));
    } finally {
      setIsTogglingTrainingMode(false);
    }
  }

  async function handleFileSelected(file: File) {
    setError(null);
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("botId", bot.id);
      formData.append("file", file);
      const data = await apiFetch<{ aiModelPath: string }>("/api/upload", { method: "POST", body: formData });
      onUpdate({ ...bot, aiModelPath: data.aiModelPath });
    } catch (err) {
      setError(toErrorMessage(err, "Upload failed"));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // Mode A (local): Rust spawns the FreqAI child process and hands back the
  // path of the one resulting .joblib file. Everything after that reuses
  // the exact same upload flow as a manual file pick — no separate
  // auth/upload path in Rust, since this JS runs inside the same
  // authenticated dashboard session whether it's a browser tab or the
  // Tauri webview.
  async function handleStartLocalTraining() {
    setError(null);
    setIsTrainingLocally(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { readFile } = await import("@tauri-apps/plugin-fs");

      const modelPath = await invoke<string>("train_local_model", {
        botId: bot.id,
        strategy: bot.strategy,
        strategyCode: bot.strategyCode,
        exchangeName: bot.exchangeName,
        autoSelectCoins: bot.autoSelectCoins,
        pairWhitelist: bot.pairWhitelist ?? "",
      });

      const bytes = await readFile(modelPath);
      const filename = modelPath.split(/[\\/]/).pop() ?? `${bot.botName}-model.joblib`;
      const file = new File([new Uint8Array(bytes)], filename, { type: "application/octet-stream" });
      await handleFileSelected(file);
    } catch (err) {
      setError(toErrorMessage(err, "Local training failed"));
    } finally {
      setIsTrainingLocally(false);
    }
  }

  // Mode B (cloud): fire-and-forget — the VM reports back on its own via
  // /api/train/cloud/callback. BotFleetGrid polls while a job is active and
  // will push the updated status into this card's props.
  async function handleStartCloudTraining() {
    setError(null);
    setIsStartingCloudTraining(true);
    try {
      const data = await apiFetch<{ job: { id: string; status: TrainingStatus; createdAt: string } }>(
        "/api/train/cloud",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ botId: bot.id }),
        },
      );
      onUpdate({
        ...bot,
        trainingMode: "CLOUD",
        latestTrainingJob: {
          id: data.job.id,
          status: data.job.status,
          mode: "CLOUD",
          errorMessage: null,
          createdAt: data.job.createdAt,
        },
      });
    } catch (err) {
      setError(toErrorMessage(err, "Failed to start cloud training"));
    } finally {
      setIsStartingCloudTraining(false);
    }
  }

  function handleDownloadConfig() {
    const config = {
      bot_name: bot.botName,
      exchange: bot.exchangeName,
      strategy: bot.strategy,
      auto_select_coins: bot.autoSelectCoins,
      pair_whitelist: bot.autoSelectCoins
        ? null
        : bot.pairWhitelist?.split(",").map((p) => p.trim()) ?? null,
      pairlist_method: bot.autoSelectCoins ? "VolumePairList (top 30 USDT by volume)" : "StaticPairList",
      stake_amount: "unlimited",
      custom_user_settings: {
        total_budget: bot.totalBudget ?? DEFAULT_PAPER_TOTAL_BUDGET,
        max_stake_pct: bot.maxStakePercentage ?? DEFAULT_PAPER_MAX_STAKE_PERCENTAGE,
      },
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
      const data = await apiFetch<{
        requiresCheckout: boolean;
        checkoutUrl?: string;
        bot?: BotConfigurationDTO;
        apiCredentials?: { username: string; password: string };
      }>("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId: bot.id }),
      });

      if (data.requiresCheckout) {
        if (data.checkoutUrl) window.location.href = data.checkoutUrl;
        return;
      }
      if (data.bot) onUpdate(data.bot);
      if (data.apiCredentials) setApiCredentials(data.apiCredentials);
    } catch (err) {
      setError(toErrorMessage(err, "Deploy failed"));
    } finally {
      setIsDeploying(false);
    }
  }

  async function handleRevealCredentials() {
    setError(null);
    setIsRevealingCredentials(true);
    try {
      const data = await apiFetch<{ username: string; password: string }>(`/api/bots/${bot.id}/credentials`);
      setApiCredentials(data);
    } catch (err) {
      setError(toErrorMessage(err, "Could not load credentials"));
    } finally {
      setIsRevealingCredentials(false);
    }
  }

  async function handleCopy(field: "username" | "password", value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 1500);
  }

  async function handleDelete() {
    if (!confirm(`Remove ${bot.botName}? This cannot be undone.`)) return;
    setError(null);
    setIsDeleting(true);
    try {
      await apiFetch(`/api/bots/${bot.id}`, { method: "DELETE" });
      onDelete(bot.id);
    } catch (err) {
      setError(toErrorMessage(err, "Failed to remove bot"));
      setIsDeleting(false);
    }
  }

  return (
    <div className="card-surface flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{bot.botName}</h3>
          <p className="text-xs text-slate-400">
            {bot.exchangeName} &middot; {bot.strategy}
          </p>
          {bot.totalBudget !== null && bot.maxStakePercentage !== null ? (
            <p className="mt-0.5 text-[11px] text-slate-500">
              Budget: €{bot.totalBudget.toLocaleString("nl-NL")} &middot; max €
              {((bot.totalBudget * bot.maxStakePercentage) / 100).toLocaleString("nl-NL", { maximumFractionDigits: 2 })} per
              trade ({bot.maxStakePercentage}%)
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] text-slate-500">Paper trading — nog geen live budget ingesteld</p>
          )}
        </div>
        <StatusBadge status={bot.deploymentStatus} />
      </div>

      <div
        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
          bot.status === "LIVE_TRADING"
            ? "border-red-500/40 bg-red-500/10 text-red-300"
            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
        }`}
      >
        <span>{bot.status === "LIVE_TRADING" ? "Live Trading" : "Paper Trading"}</span>
        {canGoLive && (
          <button
            type="button"
            onClick={() => setIsGoLiveOpen(true)}
            className="flex items-center gap-1.5 rounded-md bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-background transition hover:bg-emerald-400"
          >
            <Zap className="h-3 w-3" />
            Activeer Live Trading
          </button>
        )}
      </div>

      {isGoLiveOpen && (
        <GoLiveModal
          bot={bot}
          onClose={() => setIsGoLiveOpen(false)}
          onLive={(updated) => {
            onUpdate(updated);
            setIsGoLiveOpen(false);
          }}
        />
      )}

      <div className="space-y-2 rounded-lg border border-border p-3">
        <TrainingModeToggle
          mode={bot.trainingMode}
          onChange={handleTrainingModeChange}
          disabled={jobActive || isTogglingTrainingMode}
        />

        {bot.latestTrainingJob && (
          <div className="flex items-center justify-between gap-2">
            <TrainingStatusBadge status={bot.latestTrainingJob.status} />
            {bot.latestTrainingJob.status === "FAILED" && bot.latestTrainingJob.errorMessage && (
              <span className="truncate text-[11px] text-red-400" title={bot.latestTrainingJob.errorMessage}>
                {bot.latestTrainingJob.errorMessage}
              </span>
            )}
          </div>
        )}

        {bot.trainingMode === "CLOUD" ? (
          <button
            type="button"
            onClick={handleStartCloudTraining}
            disabled={isStartingCloudTraining || jobActive}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-accent/40 px-3 py-2 text-xs font-medium text-accent transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isStartingCloudTraining || jobActive ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Cloud className="h-3.5 w-3.5" />
            )}
            {jobActive ? "Training in the cloud…" : "Start Cloud Training"}
          </button>
        ) : isTauri() ? (
          <button
            type="button"
            onClick={handleStartLocalTraining}
            disabled={isTrainingLocally}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/40 px-3 py-2 text-xs font-medium text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isTrainingLocally ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Laptop className="h-3.5 w-3.5" />}
            {isTrainingLocally ? "Training locally…" : "Start Local Training"}
          </button>
        ) : (
          <p className="rounded-lg bg-background px-3 py-2 text-[11px] text-slate-500">
            Local training needs the Desktop App — download it from the landing page, or switch to Cloud Training.
          </p>
        )}
      </div>

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
          {bot.aiModelPath ? "Model uploaded — replace manually" : "Or upload a .joblib model manually"}
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

      {bot.deploymentStatus === "VPS_ACTIVE" && !apiCredentials && (
        <button
          type="button"
          onClick={handleRevealCredentials}
          disabled={isRevealingCredentials}
          className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500 transition hover:text-primary disabled:opacity-50"
        >
          {isRevealingCredentials ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <KeyRound className="h-3 w-3" />
          )}
          Show API credentials
        </button>
      )}

      {apiCredentials && (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-[11px]">
          <p className="text-slate-300">
            Freqtrade REST API on{" "}
            <span className="font-mono text-primary">{bot.hetznerServerIp ?? "?"}:8080</span> — save these now,
            they won&apos;t be shown in full again after you navigate away.
          </p>
          <CredentialRow label="Username" value={apiCredentials.username} field="username" onCopy={handleCopy} copied={copiedField === "username"} />
          <CredentialRow label="Password" value={apiCredentials.password} field="password" onCopy={handleCopy} copied={copiedField === "password"} />
        </div>
      )}

      <button
        type="button"
        onClick={handleDelete}
        disabled={isDeleting}
        className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500 transition hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        Remove bot
      </button>
    </div>
  );
}

interface CredentialRowProps {
  label: string;
  value: string;
  field: "username" | "password";
  copied: boolean;
  onCopy: (field: "username" | "password", value: string) => void;
}

function CredentialRow({ label, value, field, copied, onCopy }: CredentialRowProps) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-background px-2 py-1.5">
      <div className="min-w-0">
        <div className="text-slate-500">{label}</div>
        <div className="truncate font-mono text-slate-200">{value}</div>
      </div>
      <button
        type="button"
        onClick={() => onCopy(field, value)}
        className="shrink-0 rounded-md border border-border p-1.5 text-slate-400 transition hover:border-primary hover:text-primary"
        title={`Copy ${label.toLowerCase()}`}
      >
        {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}
