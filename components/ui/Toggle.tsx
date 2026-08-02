"use client";

import { cn } from "@/lib/utils";

interface TrainingModeToggleProps {
  mode: "LOCAL" | "CLOUD";
  onChange: (mode: "LOCAL" | "CLOUD") => void;
  disabled?: boolean;
}

export function TrainingModeToggle({ mode, onChange, disabled }: TrainingModeToggleProps) {
  const isCloud = mode === "CLOUD";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isCloud}
      disabled={disabled}
      onClick={() => onChange(isCloud ? "LOCAL" : "CLOUD")}
      className={cn(
        "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        isCloud
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-primary/40 bg-primary/10 text-primary",
      )}
    >
      <span>{isCloud ? "Train in the Cloud" : "Train op mijn Windows-pc"}</span>
      <span
        className={cn("relative h-5 w-9 shrink-0 rounded-full transition", isCloud ? "bg-accent/40" : "bg-primary/40")}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
            isCloud ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
