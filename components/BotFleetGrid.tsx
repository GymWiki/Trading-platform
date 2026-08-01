"use client";

import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import type { BotConfigurationDTO } from "@/lib/types";
import { BotCard } from "@/components/BotCard";
import { NewBotDialog } from "@/components/NewBotDialog";

interface BotFleetGridProps {
  initialBots: BotConfigurationDTO[];
  vpsBotQuota: number;
}

const POLL_INTERVAL_MS = 10_000;

export function BotFleetGrid({ initialBots }: BotFleetGridProps) {
  const [bots, setBots] = useState<BotConfigurationDTO[]>(initialBots);

  const hasActiveTrainingJob = bots.some(
    (b) => b.latestTrainingJob?.status === "QUEUED" || b.latestTrainingJob?.status === "TRAINING",
  );

  // Cloud training reports back asynchronously via a webhook the browser
  // never sees directly, so poll the bot list while any job is in flight.
  useEffect(() => {
    if (!hasActiveTrainingJob) return;

    const interval = setInterval(async () => {
      const res = await fetch("/api/bots");
      if (!res.ok) return;
      const data = await res.json();
      setBots(data.bots);
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [hasActiveTrainingJob]);

  function handleUpdate(updated: BotConfigurationDTO) {
    setBots((prev) => prev.map((b) => (b.id === updated.id ? { ...b, ...updated } : b)));
  }

  function handleCreated(bot: BotConfigurationDTO) {
    setBots((prev) => [bot, ...prev]);
  }

  function handleDelete(id: string) {
    setBots((prev) => prev.filter((b) => b.id !== id));
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <NewBotDialog onCreated={handleCreated} />
      </div>

      {bots.length === 0 ? (
        <div className="card-surface flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Bot className="h-10 w-10 text-slate-600" />
          <p className="text-sm text-slate-400">
            No bots yet. Train a strategy in the Desktop App, then add its configuration here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {bots.map((bot) => (
            <BotCard key={bot.id} bot={bot} onUpdate={handleUpdate} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
