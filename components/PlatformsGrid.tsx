"use client";

import { useState } from "react";
import { Link2, Plus } from "lucide-react";
import { AddPlatformDialog } from "@/components/AddPlatformDialog";
import { PlatformCard } from "@/components/PlatformCard";
import type { PlatformWithBalance } from "@/lib/platforms";
import { apiFetch } from "@/lib/api-client";
import type { FreeBalance } from "@/lib/ccxt-client";

interface PlatformsGridProps {
  initialPlatforms: PlatformWithBalance[];
}

export function PlatformsGrid({ initialPlatforms }: PlatformsGridProps) {
  const [platforms, setPlatforms] = useState<PlatformWithBalance[]>(initialPlatforms);
  const [isAddOpen, setIsAddOpen] = useState(false);

  function handleAdded(platform: PlatformWithBalance) {
    setPlatforms((prev) => [platform, ...prev]);
  }

  async function handleRefresh(id: string) {
    const data = await apiFetch<{ balance: FreeBalance }>(`/api/platforms/${id}/balance`);
    setPlatforms((prev) =>
      prev.map((p) => (p.connection.id === id ? { ...p, balance: data.balance, balanceError: null } : p)),
    );
  }

  async function handleDelete(id: string) {
    await apiFetch(`/api/platforms/${id}`, { method: "DELETE" });
    setPlatforms((prev) => prev.filter((p) => p.connection.id !== id));
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Desktop: a normal inline button in the page flow. Mobile: this
          would just be the same crowded top-of-screen row the design
          brief asks to avoid — the FAB below replaces it there instead. */}
      <div className="hidden justify-end md:flex">
        <button
          type="button"
          onClick={() => setIsAddOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-background transition hover:bg-primary-hover"
        >
          <Plus className="h-4 w-4" />
          Platform koppelen
        </button>
      </div>

      {platforms.length === 0 ? (
        <div className="card-surface flex flex-col items-center gap-3 px-6 py-14 text-center sm:py-16">
          <Link2 className="h-10 w-10 text-slate-600" />
          <p className="text-sm text-slate-400">
            Nog geen platformen gekoppeld. Koppel een exchange om je balans te zien en bots aan te maken.
          </p>
          {/* Repeated here (not just the FAB) so the empty state on mobile
              still has an obvious next step without reaching for a
              separate floating button the user hasn't noticed yet. */}
          <button
            type="button"
            onClick={() => setIsAddOpen(true)}
            className="mt-1 flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-background transition hover:bg-primary-hover md:hidden"
          >
            <Plus className="h-4 w-4" />
            Platform koppelen
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
          {platforms.map((platform) => (
            <PlatformCard
              key={platform.connection.id}
              platform={platform}
              onRefresh={handleRefresh}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Mobile FAB, floating just above BottomNav (see components/BottomNav.tsx)
          rather than a second full-width sticky bar stacked on top of it —
          the standard "primary action" pattern in consumer apps (Gmail,
          most fintech apps) once a bottom tab bar is already in play.
          Hidden while the dialog itself is open — with the trigger and the
          modal as DOM siblings rather than nested, "just raise the z-index"
          leaves the FAB in the hit-testing order above the backdrop; not
          rendering it at all while isAddOpen is simpler and unambiguous. */}
      {platforms.length > 0 && !isAddOpen && (
        <button
          type="button"
          onClick={() => setIsAddOpen(true)}
          aria-label="Platform koppelen"
          className="fixed bottom-20 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-background shadow-lg shadow-black/30 transition hover:bg-primary-hover md:hidden"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}

      {isAddOpen && (
        <AddPlatformDialog
          connectedExchangeIds={platforms.map((p) => p.connection.exchangeName)}
          onAdded={handleAdded}
          onClose={() => setIsAddOpen(false)}
        />
      )}
    </div>
  );
}
