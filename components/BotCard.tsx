"use client";

import { useEffect, useRef, useState } from "react";
import {
  Download,
  Rocket,
  Upload,
  Loader2,
  CheckCircle2,
  Trash2,
  Cloud,
  Laptop,
  KeyRound,
  Copy,
  Check,
  Zap,
  AlertOctagon,
  Moon,
  PlayCircle,
  PauseCircle,
  Link2,
  ShieldCheck,
  ShieldAlert,
  Unlink,
  XCircle,
} from "lucide-react";
import type { BotConfigurationDTO, ExchangeConnectionDTO, TrainingStatus } from "@/lib/types";
import { StatusBadge, TrainingStatusBadge } from "@/components/ui/StatusBadge";
import { TrainingModeToggle } from "@/components/ui/Toggle";
import { GoLiveModal } from "@/components/GoLiveModal";
import { ConnectExchangeDialog } from "@/components/ConnectExchangeDialog";
import { TradeHistoryFeed } from "@/components/TradeHistoryFeed";
import { TrainingProgressBar } from "@/components/TrainingProgressBar";
import { ClientDownloadProgressBar } from "@/components/ClientDownloadProgressBar";
import { Switch } from "@/components/ui/Switch";
import { EXCHANGE_PRESETS } from "@/lib/exchange-presets";
import { DEFAULT_PAPER_TOTAL_BUDGET, DEFAULT_PAPER_MAX_STAKE_PERCENTAGE } from "@/lib/paper-trading-defaults";
import { isTauri } from "@/lib/tauri";
import { apiFetch, toErrorMessage } from "@/lib/api-client";
import { downloadAndUploadTrainingData, ClientDataDownloadError } from "@/lib/client-data-download";
import {
  buildPrefetchPlan,
  isBackgroundFetchSupported,
  isBackgroundFetchWorthwhile,
  startBackgroundFetchDownload,
  formatBytes,
} from "@/lib/background-fetch-download";
import { getPendingDownload, clearPendingDownload, type PendingDownload } from "@/lib/training-data-db";

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
  const [isStoppingTraining, setIsStoppingTraining] = useState(false);
  const [isRevealingCredentials, setIsRevealingCredentials] = useState(false);
  const [apiCredentials, setApiCredentials] = useState<{ username: string; password: string } | null>(null);
  const [copiedField, setCopiedField] = useState<"username" | "password" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGoLiveOpen, setIsGoLiveOpen] = useState(false);
  const [isTogglingTrainingMode, setIsTogglingTrainingMode] = useState(false);
  const [isTogglingAutoCompound, setIsTogglingAutoCompound] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isConnectExchangeOpen, setIsConnectExchangeOpen] = useState(false);
  const [isDisconnectingExchange, setIsDisconnectingExchange] = useState(false);
  // Only set once the start-cloud-training call actually succeeds (not on
  // the click itself) — see handleStartCloudTraining. Auto-dismisses after
  // a few seconds; the persistent, ongoing signal is TrainingProgressBar
  // below, this is just the one-shot "yep, it started" confirmation.
  const [justStartedCloudTraining, setJustStartedCloudTraining] = useState(false);
  const justStartedCloudTrainingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Real progress for the client-side pre-fetch phase (see
  // lib/client-data-download.ts) — null before it starts and once it's
  // done, set only while isStartingCloudTraining covers that phase.
  // downloadAbortControllerRef is what the "Annuleren" button below
  // actually cancels: no TrainingJob/VPS exists yet at this point, so
  // there's nothing for the existing job-based handleStopTraining to stop.
  const [downloadProgress, setDownloadProgress] = useState<{ completedTasks: number; totalTasks: number } | null>(null);
  const downloadAbortControllerRef = useRef<AbortController | null>(null);
  // Set right before falling back to the foreground path, so the UI can
  // explain *why* — "your browser doesn't support this" reads very
  // differently from "too many pairs for one background job" even though
  // both land on the same code path. Null whenever the background-fetch
  // path is in play (nothing to explain).
  const [foregroundFallbackReason, setForegroundFallbackReason] = useState<string | null>(null);

  // Live state for a Background Fetch registration created by THIS tab in
  // THIS session — lost on reload/navigation, which is fine: the actual
  // source of truth for "did it finish" is IndexedDB (pendingDownload
  // below) + the service worker's own postMessage, not this ref.
  const [backgroundFetchRegistration, setBackgroundFetchRegistration] = useState<BackgroundFetchRegistration | null>(null);
  const [backgroundFetchDownloadedBytes, setBackgroundFetchDownloadedBytes] = useState(0);

  // A background download that finished — possibly while this tab, or any
  // tab, was closed — discovered via IndexedDB on mount and/or a live
  // postMessage from the service worker if a fetch finishes while this
  // card happens to be mounted. Deliberately requires an explicit click to
  // actually start training (handleConfirmBackgroundDownload) rather than
  // auto-provisioning a VPS the instant this fires — the user might not be
  // looking, possibly hours later.
  const [pendingDownload, setPendingDownload] = useState<PendingDownload | null>(null);
  const [isConfirmingBackgroundDownload, setIsConfirmingBackgroundDownload] = useState(false);

  useEffect(() => {
    return () => downloadAbortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;
    getPendingDownload(bot.id).then((record) => {
      if (!cancelled && record) setPendingDownload(record);
    });
    return () => {
      cancelled = true;
    };
  }, [bot.id]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (data && data.type === "training-data-ready" && data.botId === bot.id) {
        setPendingDownload({
          botId: data.botId,
          uploadSessionId: data.uploadSessionId,
          files: data.files,
          completedAt: data.completedAt,
        });
        setBackgroundFetchRegistration(null);
      }
    }
    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, [bot.id]);

  // Optimistic overrides for the two network-backed toggles below: bot.X
  // only changes once the parent re-renders with a fresh prop after
  // onUpdate, which used to leave the switch visually frozen in its old
  // position for the whole PATCH round-trip. Set on click, cleared once
  // that PATCH settles (success or failure) — cleared, not left set, so a
  // failed request correctly snaps back to the real bot.X value rather
  // than getting stuck showing a change that was never actually saved.
  const [optimisticTrainingMode, setOptimisticTrainingMode] = useState<"LOCAL" | "CLOUD" | null>(null);
  const [optimisticAutoCompound, setOptimisticAutoCompound] = useState<boolean | null>(null);
  // React's `disabled` prop on the toggle only takes effect on the render
  // *after* the state update that sets isToggling*, so a fast double-click
  // (or a click event firing twice for any other reason) can still reach
  // this handler a second time before that re-render commits. A ref is
  // read/written synchronously, immune to that timing gap, so it's the
  // actual guard against a double-fire — isToggling* alone (disabling the
  // button) is a courtesy for slow networks, not a correctness guarantee.
  const trainingModeInFlight = useRef(false);
  const autoCompoundInFlight = useRef(false);

  const jobActive = bot.latestTrainingJob?.status === "QUEUED" || bot.latestTrainingJob?.status === "TRAINING";
  const canGoLive = bot.status === "TRAINING_PAPER_TRADE" && bot.deploymentStatus === "VPS_ACTIVE";
  const isPaused = bot.status === "PAUSED_EMERGENCY" || bot.status === "SLEEPING" || bot.status === "PAUSED_MANUAL";
  // Only this bot's own, currently-running trading loop can be stopped —
  // matches exactly what POST /api/bots/[id]/stop itself requires.
  const canStop =
    bot.deploymentStatus === "VPS_ACTIVE" && (bot.status === "TRAINING_PAPER_TRADE" || bot.status === "LIVE_TRADING");

  useEffect(() => {
    return () => {
      if (justStartedCloudTrainingTimeout.current) clearTimeout(justStartedCloudTrainingTimeout.current);
    };
  }, []);

  // Clears PAUSED_EMERGENCY (Panic Button), SLEEPING (Sleep Mode), or
  // PAUSED_MANUAL (Stop bot, below) — the only place any of the three is
  // ever cleared, see app/api/bots/[id]/resume.
  async function handleResume() {
    setError(null);
    setIsResuming(true);
    try {
      const data = await apiFetch<{ bot: BotConfigurationDTO }>(`/api/bots/${bot.id}/resume`, { method: "POST" });
      onUpdate(data.bot);
    } catch (err) {
      setError(toErrorMessage(err, "Hervatten is mislukt"));
    } finally {
      setIsResuming(false);
    }
  }

  // Stops just this bot — no new positions open, existing ones keep
  // running untouched (see app/api/bots/[id]/stop for the exact
  // guarantee). Deliberately a plain confirm(), matching the weight
  // handleDisconnectExchange already uses for a reversible single-bot
  // action, unlike the heavier custom modal the global Panic Button (a
  // real-money, force-close action across every bot) warrants.
  async function handleStop() {
    if (
      !confirm(
        `${bot.botName} stoppen? Er worden geen nieuwe posities meer geopend — bestaande open posities blijven gewoon lopen. Je kan de bot daarna weer hervatten.`,
      )
    ) {
      return;
    }
    setError(null);
    setIsStopping(true);
    try {
      const data = await apiFetch<{ bot: BotConfigurationDTO }>(`/api/bots/${bot.id}/stop`, { method: "POST" });
      onUpdate(data.bot);
    } catch (err) {
      setError(toErrorMessage(err, "Stoppen is mislukt"));
    } finally {
      setIsStopping(false);
    }
  }

  async function handleTrainingModeChange(trainingMode: "LOCAL" | "CLOUD") {
    if (trainingModeInFlight.current) return;
    trainingModeInFlight.current = true;
    setError(null);
    setIsTogglingTrainingMode(true);
    setOptimisticTrainingMode(trainingMode);
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
      setOptimisticTrainingMode(null);
      setIsTogglingTrainingMode(false);
      trainingModeInFlight.current = false;
    }
  }

  // Only flips the DB flag — the next (re)deploy is what actually reads it
  // into config.json (see lib/deploy-bot.ts, lib/hetzner.ts), same as a
  // totalBudget change via Go Live.
  async function handleAutoCompoundChange(autoCompound: boolean) {
    if (autoCompoundInFlight.current) return;
    autoCompoundInFlight.current = true;
    setError(null);
    setIsTogglingAutoCompound(true);
    setOptimisticAutoCompound(autoCompound);
    try {
      const data = await apiFetch<{ bot: BotConfigurationDTO }>(`/api/bots/${bot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoCompound }),
      });
      onUpdate(data.bot);
    } catch (err) {
      setError(toErrorMessage(err, "Kon auto-compounding niet wijzigen"));
    } finally {
      setOptimisticAutoCompound(null);
      setIsTogglingAutoCompound(false);
      autoCompoundInFlight.current = false;
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
        // Rust's own train_local_model ignores this anyway — see
        // DATA_SOURCE_EXCHANGE in src-tauri/src/main.rs — but the Tauri
        // command's String param can't take null, and a bot may not have
        // an exchange yet (see prisma/schema.prisma).
        exchangeName: bot.exchangeName ?? "",
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

  // Actually calls POST /api/train/cloud once preloaded data is ready —
  // shared by both the foreground path (right after its own download
  // finishes) and handleConfirmBackgroundDownload (once the user confirms
  // a background download that already finished, possibly in an earlier
  // session). Only ever reachable once every file has uploaded
  // successfully, which is what guarantees no VPS/TrainingJob ever gets
  // created for a download that failed or was cancelled partway through.
  async function submitPreloadedTraining(uploadSessionId: string, files: Array<{ pair: string; timeframe: string }>) {
    const data = await apiFetch<{ job: { id: string; status: TrainingStatus; createdAt: string } }>(
      "/api/train/cloud",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId: bot.id, uploadSessionId, preloadedFiles: files }),
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
    setJustStartedCloudTraining(true);
    if (justStartedCloudTrainingTimeout.current) clearTimeout(justStartedCloudTrainingTimeout.current);
    justStartedCloudTrainingTimeout.current = setTimeout(() => setJustStartedCloudTraining(false), 6000);
  }

  // Mode B (cloud): first the browser fetches every pair/timeframe's
  // historical candles itself (over the user's own connection) and
  // uploads them to Storage; only once every file has uploaded
  // successfully does anything call POST /api/train/cloud (via
  // submitPreloadedTraining above) and actually provision a VPS.
  //
  // Two ways that download can run:
  //  - Background Fetch (Chrome/Edge, Android + desktop — see the chat
  //    reply alongside this feature for the full support matrix): the
  //    browser's own download manager drives it, so it survives this tab
  //    closing or the user switching apps. This function then just
  //    *starts* it and returns — completion is discovered later via
  //    public/sw.js's postMessage (if a tab is open) or the pendingDownload
  //    IndexedDB check on mount (if not), never awaited here directly.
  //  - The foreground path (lib/client-data-download.ts) otherwise —
  //    Safari/iOS, Firefox, or a plan with more pair/timeframe pages than
  //    MAX_BACKGROUND_FETCH_REQUESTS. This one only keeps running while
  //    this tab stays open, which is why isStartingCloudTraining's button
  //    label and foregroundFallbackReason's notice both call that out.
  async function handleStartCloudTraining() {
    setError(null);
    setIsStartingCloudTraining(true);
    setDownloadProgress(null);
    setForegroundFallbackReason(null);

    try {
      if (isBackgroundFetchSupported()) {
        const plan = await buildPrefetchPlan(bot);
        if (isBackgroundFetchWorthwhile(plan)) {
          const uploadSessionId = crypto.randomUUID();
          const registration = await startBackgroundFetchDownload(bot.id, bot.botName, uploadSessionId, plan);
          setBackgroundFetchRegistration(registration);
          setBackgroundFetchDownloadedBytes(0);
          registration.onprogress = () => setBackgroundFetchDownloadedBytes(registration.downloaded);
          setIsStartingCloudTraining(false);
          return;
        }
        setForegroundFallbackReason(
          `Te veel bestanden (${plan.requests.length}) voor één achtergrond-download — normale download wordt gebruikt.`,
        );
      } else {
        setForegroundFallbackReason(
          "Achtergronddownload wordt niet ondersteund in deze browser — houd deze pagina open tijdens het downloaden.",
        );
      }

      const controller = new AbortController();
      downloadAbortControllerRef.current = controller;
      const { uploadSessionId, files } = await downloadAndUploadTrainingData(bot, {
        signal: controller.signal,
        onProgress: (p) => setDownloadProgress({ completedTasks: p.completedTasks, totalTasks: p.totalTasks }),
      });
      downloadAbortControllerRef.current = null;
      setDownloadProgress(null);
      await submitPreloadedTraining(uploadSessionId, files);
    } catch (err) {
      // A cancel via the "Annuleren" button below aborts the controller,
      // which surfaces here as this specific error — no VPS/job was ever
      // created, so there's nothing further to undo, just go quiet. Any
      // OTHER ClientDataDownloadError (no data found, an upload that
      // actually failed, ...) is a real failure and still needs to reach
      // the user, same as any other error here.
      if (!(err instanceof ClientDataDownloadError && err.message === "Download geannuleerd.")) {
        setError(toErrorMessage(err, "Failed to start cloud training"));
      }
    } finally {
      downloadAbortControllerRef.current = null;
      setDownloadProgress(null);
      setIsStartingCloudTraining(false);
    }
  }

  // Cancels the client-side pre-fetch phase only — there is no VPS or
  // TrainingJob yet at this point (see handleStartCloudTraining's own doc
  // comment), so unlike handleStopTraining below, this never touches the
  // network beyond aborting in-flight requests.
  function handleCancelClientDownload() {
    downloadAbortControllerRef.current?.abort();
  }

  function handleCancelBackgroundFetch() {
    backgroundFetchRegistration?.abort();
    setBackgroundFetchRegistration(null);
  }

  // The user confirms a Background Fetch that already finished — see
  // pendingDownload's own doc comment for why this is a deliberate click
  // rather than automatic.
  async function handleConfirmBackgroundDownload() {
    if (!pendingDownload) return;
    setError(null);
    setIsConfirmingBackgroundDownload(true);
    try {
      await submitPreloadedTraining(pendingDownload.uploadSessionId, pendingDownload.files);
      await clearPendingDownload(bot.id);
      setPendingDownload(null);
    } catch (err) {
      setError(toErrorMessage(err, "Kon de training niet starten met de opgehaalde data"));
    } finally {
      setIsConfirmingBackgroundDownload(false);
    }
  }

  function handleDismissPendingDownload() {
    clearPendingDownload(bot.id).then(() => setPendingDownload(null));
  }

  // Cancels the in-flight Cloud Training job and deletes its Hetzner server
  // (see POST /api/train/cloud/stop, which reuses the same
  // deleteHetznerServer() the reap cron uses). Returns the fresh bot DTO —
  // its latestTrainingJob.status flips to CANCELLED, which is enough on its
  // own to flip jobActive false below and unmount TrainingProgressBar, so
  // there's nothing extra to do here to "stop polling".
  async function handleStopTraining() {
    if (!bot.latestTrainingJob) return;
    if (!confirm("Weet je zeker dat je de training wilt stoppen? De cloud-server wordt direct verwijderd.")) {
      return;
    }
    setError(null);
    setIsStoppingTraining(true);
    try {
      const data = await apiFetch<{ bot: BotConfigurationDTO }>("/api/train/cloud/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: bot.latestTrainingJob.id }),
      });
      onUpdate(data.bot);
    } catch (err) {
      setError(toErrorMessage(err, "Stoppen van de training is mislukt"));
    } finally {
      setIsStoppingTraining(false);
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

  async function handleDisconnectExchange() {
    if (!confirm("Exchange-account ontkoppelen van deze bot?")) return;
    setError(null);
    setIsDisconnectingExchange(true);
    try {
      await apiFetch(`/api/bots/${bot.id}/exchange-connection`, { method: "DELETE" });
      onUpdate({ ...bot, exchangeConnection: null });
    } catch (err) {
      setError(toErrorMessage(err, "Ontkoppelen is mislukt"));
    } finally {
      setIsDisconnectingExchange(false);
    }
  }

  return (
    <div className="card-surface flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{bot.botName}</h3>
          <p className="text-xs text-slate-400">
            {bot.exchangeName ? <>{bot.exchangeName} &middot; </> : null}
            {bot.strategy}
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
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusBadge status={bot.deploymentStatus} />
          {canStop && (
            <button
              type="button"
              onClick={handleStop}
              disabled={isStopping}
              className="flex items-center gap-1 rounded-md border border-amber-500/40 px-2 py-1 text-[11px] font-medium text-amber-400 transition hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isStopping ? <Loader2 className="h-3 w-3 animate-spin" /> : <PauseCircle className="h-3 w-3" />}
              Stop bot
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg bg-background px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-200">Exchange-account</p>
          {bot.exchangeConnection ? (
            <p className="mt-0.5 flex items-center gap-1 text-[11px]">
              {bot.exchangeConnection.verified ? (
                <>
                  <ShieldCheck className="h-3 w-3 shrink-0 text-primary" />
                  <span className="text-primary">Geverifieerd</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="h-3 w-3 shrink-0 text-amber-400" />
                  <span className="text-amber-400">Niet geverifieerd</span>
                </>
              )}
              <span className="text-slate-500">
                &middot; {EXCHANGE_PRESETS.find((e) => e.id === bot.exchangeConnection?.exchangeName)?.label ?? bot.exchangeConnection.exchangeName}
              </span>
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] text-slate-500">
              Nog niet gekoppeld — alleen nodig om live te gaan, training/paper trading werkt zonder.
            </p>
          )}
        </div>
        {bot.exchangeConnection ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsConnectExchangeOpen(true)}
              className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:border-primary hover:text-primary"
            >
              Vervang
            </button>
            <button
              type="button"
              onClick={handleDisconnectExchange}
              disabled={isDisconnectingExchange}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:border-red-500/50 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isDisconnectingExchange ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
              Ontkoppel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsConnectExchangeOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-background transition hover:bg-primary-hover"
          >
            <Link2 className="h-3 w-3" />
            Koppel exchange account
          </button>
        )}
      </div>

      {isConnectExchangeOpen && (
        <ConnectExchangeDialog
          botId={bot.id}
          botName={bot.botName}
          exchangeName={bot.exchangeName}
          onConnected={(connection) => onUpdate({ ...bot, exchangeConnection: connection })}
          onClose={() => setIsConnectExchangeOpen(false)}
        />
      )}

      <div className="flex items-center justify-between gap-3 rounded-lg bg-background px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-200">Auto-Compounding</p>
          <p className="text-[11px] text-slate-500">
            Herinvesteer winst automatisch in grotere posities — actief vanaf de volgende (re)deploy.
          </p>
        </div>
        <Switch
          checked={optimisticAutoCompound ?? bot.autoCompound}
          onChange={handleAutoCompoundChange}
          disabled={isTogglingAutoCompound}
          aria-label="Auto-Compounding"
        />
      </div>

      {isPaused && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs">
          <div className="flex items-center gap-1.5 font-medium text-amber-300">
            {bot.status === "PAUSED_EMERGENCY" ? (
              <AlertOctagon className="h-3.5 w-3.5 shrink-0" />
            ) : bot.status === "SLEEPING" ? (
              <Moon className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <PauseCircle className="h-3.5 w-3.5 shrink-0" />
            )}
            {bot.status === "PAUSED_EMERGENCY"
              ? "Noodstop actief"
              : bot.status === "SLEEPING"
                ? "In slaapstand — even geen activiteit"
                : "Gestopt — bestaande posities blijven gewoon lopen"}
          </div>
          {bot.lastError && <p className="text-amber-200/80">{bot.lastError}</p>}
          <button
            type="button"
            onClick={handleResume}
            disabled={isResuming}
            className="flex items-center justify-center gap-1.5 self-start rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-background transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isResuming ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
            Hervat bot
          </button>
        </div>
      )}

      <div
        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
          bot.status === "PAUSED_MANUAL"
            ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
            : bot.isPaperTrading
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-red-500/40 bg-red-500/10 text-red-300"
        }`}
      >
        {/* isPaperTrading (not bot.status) drives this label — status now
            also covers pause states (PAUSED_EMERGENCY/SLEEPING) that don't
            imply a mode switch, so it can't double as "which mode" there.
            PAUSED_MANUAL is the one exception: the user explicitly asked
            this pill itself to read "Gestopt" instead of "Paper Trading"/
            "Live Trading" while a bot is individually stopped. */}
        <span>{bot.status === "PAUSED_MANUAL" ? "Gestopt" : bot.isPaperTrading ? "Paper Trading" : "Live Trading"}</span>
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

      {justStartedCloudTraining && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2.5 text-xs font-medium text-primary">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          Cloud training gestart voor {bot.botName} — dit kan een tijdje duren.
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-border p-3">
        <TrainingModeToggle
          mode={optimisticTrainingMode ?? bot.trainingMode}
          onChange={handleTrainingModeChange}
          disabled={jobActive || isTogglingTrainingMode}
        />

        {bot.latestTrainingJob && (
          <div className="flex flex-col gap-1.5">
            <TrainingStatusBadge status={bot.latestTrainingJob.status} />
            {/* Full message, wrapped — never truncated. These reap/callback
                reasons ("Reaped: no progress past QUEUED for over 20
                minutes — ...") are exactly the part that explains what
                happened, so cutting them off with an ellipsis defeated the
                point of showing them at all. */}
            {bot.latestTrainingJob.status === "FAILED" && bot.latestTrainingJob.errorMessage && (
              <p className="whitespace-pre-wrap break-words text-[11px] text-red-400">
                {bot.latestTrainingJob.errorMessage}
              </p>
            )}
          </div>
        )}

        {bot.trainingMode === "CLOUD" ? (
          <>
            {/* A Background Fetch finished — possibly while this tab, or
                every tab, was closed (see pendingDownload's own doc
                comment for why this needs an explicit click rather than
                auto-starting). Shown ahead of everything else below since
                it's actionable regardless of what state the rest of the
                card is in. */}
            {pendingDownload && !jobActive && (
              <div className="space-y-1.5 rounded-lg border border-primary/40 bg-primary/10 p-2.5">
                <p className="text-[11px] font-medium text-primary">
                  Marktdata is op de achtergrond opgehaald ({pendingDownload.files.length} bestanden) — klaar om te
                  trainen.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleConfirmBackgroundDownload}
                    disabled={isConfirmingBackgroundDownload}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-background transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isConfirmingBackgroundDownload ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
                    Training starten
                  </button>
                  <button
                    type="button"
                    onClick={handleDismissPendingDownload}
                    disabled={isConfirmingBackgroundDownload}
                    className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-slate-400 transition hover:bg-surfaceHover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Negeren
                  </button>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleStartCloudTraining}
              disabled={isStartingCloudTraining || jobActive || !!backgroundFetchRegistration}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/40 px-3 py-2 text-xs font-medium text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isStartingCloudTraining || jobActive ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Cloud className="h-3.5 w-3.5" />
              )}
              {jobActive
                ? "Training in de cloud…"
                : backgroundFetchRegistration
                  ? "Data wordt op de achtergrond opgehaald…"
                  : isStartingCloudTraining
                    ? "Data ophalen…"
                    : "Start Cloud Training"}
            </button>

            {/* Background Fetch in progress — survives this tab closing or
                the user switching apps (see
                lib/background-fetch-download.ts). downloaded is bytes, not
                a task count — Background Fetch doesn't expose a reliable
                "N of M requests done" count, only bytes transferred, which
                is also exactly what the browser's own system notification
                is built around. */}
            {backgroundFetchRegistration && (
              <div className="space-y-1.5 rounded-lg border border-border bg-background p-2.5">
                <p className="text-[11px] text-slate-400">
                  {formatBytes(backgroundFetchDownloadedBytes)} opgehaald. Je kunt deze pagina sluiten of naar een
                  andere app schakelen — de systeemmelding houdt je op de hoogte.
                </p>
                <button
                  type="button"
                  onClick={handleCancelBackgroundFetch}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/40 px-3 py-2 text-xs font-medium text-red-400 transition hover:bg-red-500/10"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Annuleren
                </button>
              </div>
            )}

            {/* Client-side pre-fetch phase — before any VPS exists (see
                handleStartCloudTraining). Cancelling here just aborts
                requests, no server-side stop call needed. */}
            {isStartingCloudTraining && downloadProgress && (
              <>
                {foregroundFallbackReason && <p className="text-[11px] text-accent">{foregroundFallbackReason}</p>}
                <ClientDownloadProgressBar
                  completedTasks={downloadProgress.completedTasks}
                  totalTasks={downloadProgress.totalTasks}
                />
                <button
                  type="button"
                  onClick={handleCancelClientDownload}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/40 px-3 py-2 text-xs font-medium text-red-400 transition hover:bg-red-500/10"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Annuleren
                </button>
              </>
            )}
            {/* Own polling loop, distinct from BotFleetGrid's slower
                fleet-wide refresh — see that component's doc comment. */}
            {jobActive && bot.latestTrainingJob && (
              <>
                <TrainingProgressBar jobId={bot.latestTrainingJob.id} />
                <button
                  type="button"
                  onClick={handleStopTraining}
                  disabled={isStoppingTraining}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/40 px-3 py-2 text-xs font-medium text-red-400 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isStoppingTraining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                  {isStoppingTraining ? "Wordt gestopt…" : "Stop training"}
                </button>
              </>
            )}
          </>
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

      {bot.deploymentStatus === "VPS_ACTIVE" && <TradeHistoryFeed botId={bot.id} />}

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
