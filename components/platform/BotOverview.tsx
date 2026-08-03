import { Plus } from "lucide-react";
import { BotCard, type BotSummary } from "@/components/platform/BotCard";

export function BotOverview({ bots }: { bots: BotSummary[] }) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-panda-display text-lg font-semibold text-panda-cream">Jouw bots</h2>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full bg-panda-charcoal px-3.5 py-2 text-xs font-semibold text-panda-cream transition hover:bg-panda-charcoal-light"
        >
          <Plus className="h-3.5 w-3.5" />
          Nieuwe bot
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {bots.map((bot) => (
          <BotCard key={bot.id} bot={bot} />
        ))}
      </div>
    </section>
  );
}
