import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeploymentStatus, TrainingStatus } from "@/lib/types";

const STYLES: Record<DeploymentStatus, string> = {
  LOCAL: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  VPS_ACTIVE: "bg-primary/10 text-primary border-primary/30",
  INACTIVE: "bg-slate-700/30 text-slate-500 border-slate-600/30",
};

const LABELS: Record<DeploymentStatus, string> = {
  LOCAL: "Local only",
  VPS_ACTIVE: "Live on VPS",
  INACTIVE: "Inactive",
};

export function StatusBadge({ status }: { status: DeploymentStatus }) {
  return (
    <span className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-medium", STYLES[status])}>
      {status === "VPS_ACTIVE" && (
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" />
      )}
      {LABELS[status]}
    </span>
  );
}

const TRAINING_STYLES: Record<TrainingStatus, string> = {
  QUEUED: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  TRAINING: "bg-accent/10 text-accent border-accent/30",
  COMPLETED: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  FAILED: "bg-red-500/10 text-red-300 border-red-500/30",
};

const TRAINING_LABELS: Record<TrainingStatus, string> = {
  QUEUED: "Queued",
  TRAINING: "Training…",
  COMPLETED: "Training complete",
  FAILED: "Training failed",
};

export function TrainingStatusBadge({ status }: { status: TrainingStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        TRAINING_STYLES[status],
      )}
    >
      {(status === "QUEUED" || status === "TRAINING") && <Loader2 className="h-3 w-3 animate-spin" />}
      {TRAINING_LABELS[status]}
    </span>
  );
}
