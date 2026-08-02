"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
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
    <div className="space-y-6">
      <div className="flex justify-end">
        <AddPlatformDialog connectedExchangeIds={platforms.map((p) => p.connection.exchangeName)} onAdded={handleAdded} />
      </div>

      {platforms.length === 0 ? (
        <div className="card-surface flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Link2 className="h-10 w-10 text-slate-600" />
          <p className="text-sm text-slate-400">
            Nog geen platformen gekoppeld. Koppel een exchange om je balans te zien en bots aan te maken.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
    </div>
  );
}
