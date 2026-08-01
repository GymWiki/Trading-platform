import { cn } from "@/lib/utils";
import type { DeploymentStatus } from "@/lib/types";

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
