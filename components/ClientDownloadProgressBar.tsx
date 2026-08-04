"use client";

// Real, non-estimated progress for the client-side pre-fetch phase (see
// lib/client-data-download.ts) — completedTasks/totalTasks straight from
// the actual fetch calls the browser has finished, unlike
// TrainingProgressBar's time-based ETA blend (there's no VM to poll yet at
// this point, just this tab's own in-flight requests).
interface ClientDownloadProgressBarProps {
  completedTasks: number;
  totalTasks: number;
}

export function ClientDownloadProgressBar({ completedTasks, totalTasks }: ClientDownloadProgressBarProps) {
  const percent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-400">Historische data ophalen (via jouw verbinding)…</span>
        <span className="tabular-nums text-slate-500">{percent}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-background" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-[11px] text-slate-500">
        {completedTasks} / {totalTasks} paar/timeframe-bestanden opgehaald
      </p>
    </div>
  );
}
