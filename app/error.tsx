"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

// Next.js App Router's error boundary for everything under the root
// layout (dashboard, platforms, login, signup, landing) — a render crash
// anywhere in that tree lands here instead of a blank white screen. Server
// and client component errors alike are caught; only errors thrown from
// this file's own render, or from layout.tsx itself, escape to
// global-error.tsx.
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[RootError] Unhandled render error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="card-surface flex max-w-md flex-col items-center gap-3 p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-red-400" />
        <h1 className="text-lg font-semibold">Er is iets misgegaan</h1>
        <p className="text-sm text-slate-400">
          Deze pagina is onverwacht gecrasht. Probeer het opnieuw — je gegevens zijn niet verloren gegaan.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-2 flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-background transition hover:bg-primary-hover"
        >
          <RotateCcw className="h-4 w-4" />
          Probeer opnieuw
        </button>
      </div>
    </div>
  );
}
