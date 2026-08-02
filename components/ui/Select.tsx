"use client";

import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
}

// A themed, accessible dropdown (keyboard nav, focus management, ARIA
// listbox semantics all handled by Radix) — used instead of a native
// <select> because a browser's native popup can't be reliably dark-themed
// across OSes, which would break the rest of this UI's look.
export function Select({ value, onChange, options, placeholder, id, ...aria }: SelectProps) {
  const selected = options.find((o) => o.value === value);

  return (
    <RadixSelect.Root value={value} onValueChange={onChange}>
      <RadixSelect.Trigger
        id={id}
        aria-label={aria["aria-label"]}
        className="input flex items-center justify-between gap-2 text-left data-[placeholder]:text-slate-500"
      >
        <RadixSelect.Value placeholder={placeholder}>
          {selected ? selected.label : undefined}
        </RadixSelect.Value>
        <RadixSelect.Icon>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
          className="z-[60] max-h-72 w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                className={cn(
                  "flex cursor-pointer flex-col rounded-md px-2.5 py-2 text-sm text-slate-200 outline-none transition",
                  "data-[highlighted]:bg-primary/10 data-[highlighted]:text-primary",
                  "data-[state=checked]:text-primary",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator>
                    <Check className="h-3.5 w-3.5" />
                  </RadixSelect.ItemIndicator>
                </div>
                {option.description && (
                  <span className="text-xs text-slate-500">{option.description}</span>
                )}
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
