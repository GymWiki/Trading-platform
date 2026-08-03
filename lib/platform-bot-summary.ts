import type { BotConfigurationDTO } from "@/lib/types";
import type { BotSummary } from "@/components/platform/BotCard";

// Turns a bot's real, already-loaded DB props (the exact BotConfigurationDTO
// /dashboard itself renders from) into the FreqPanda card shape. Reuses
// only fields already on the DTO — no live freqtrade/trades calls here,
// unlike TradeHistoryFeed's GET /api/bots/[id]/trades — so this stays
// fast and safe to run for every bot on every page load.
//
// roiPercent is deliberately left undefined: there is no stored ROI
// anywhere in the schema, and a real figure needs live trade data. Wire
// GET /api/bots/[id]/trades client-side (see components/TradeHistoryFeed.tsx
// for the exact pattern this app already uses) if/when that's needed here
// — BotCard already renders fine without it.
export function toBotSummary(bot: BotConfigurationDTO): BotSummary {
  return {
    id: bot.id,
    name: bot.botName,
    mode: bot.isPaperTrading ? "paper" : "live",
    lastTradeSummary: describeBotStatus(bot),
  };
}

// A plain-language line derived from real, already-available status props
// (bot.status/deploymentStatus/lastError) — not an actual last trade
// (that lives on the deployed instance itself, see lib/trade-humanizer.ts
// for the real trade-level humanization), but honest about what it is:
// where things stand right now, in words a non-technical user reads
// instantly.
function describeBotStatus(bot: BotConfigurationDTO): string {
  switch (bot.status) {
    case "TRAINING":
      return "Model wordt getraind — nog geen trades.";
    case "UPDATING_MODEL":
      return "Gepauzeerd terwijl het model wordt bijgewerkt.";
    case "PAUSED_EMERGENCY":
      return "Noodstop actief — alle posities zijn gesloten.";
    case "SLEEPING":
      return "In slaapstand na een periode zonder activiteit.";
    case "ERROR":
      return bot.lastError ?? "Er ging iets mis — bekijk de details in het dashboard.";
    case "LIVE_TRADING":
      return "Draait live met echt geld.";
    case "TRAINING_PAPER_TRADE":
    default:
      return bot.deploymentStatus === "VPS_ACTIVE"
        ? "Draait paper-trading op de VPS."
        : "Nog niet gedeployed — upload een model en deploy om te starten.";
  }
}
