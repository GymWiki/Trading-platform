"use client";

import * as RadixTooltip from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";

// A small info-icon that reveals a helper text on hover/focus — Radix
// handles the accessibility groundwork (keyboard-focusable trigger,
// role="tooltip", Escape-to-dismiss, appropriate delay) that's easy to get
// subtly wrong hand-rolled.
export function InfoTooltip({ text }: { text: string }) {
  return (
    <RadixTooltip.Provider delayDuration={200}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>
          <button
            type="button"
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-slate-500 outline-none transition hover:text-primary focus-visible:text-primary"
            aria-label="Meer uitleg"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side="top"
            sideOffset={6}
            className="z-[60] max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-slate-300 shadow-xl"
          >
            {text}
            <RadixTooltip.Arrow className="fill-surface" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
