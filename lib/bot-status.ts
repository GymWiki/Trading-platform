// The state machine gating live trading. Every code path that could cause a
// bot to start or resume trading — right now that's exclusively
// /api/deploy, plus the resume step after a retrain finishes — must check
// this before doing anything. TRAINING and UPDATING_MODEL are the two
// statuses live trading may never overlap with.
export type BotStatus = "IDLE" | "TRAINING" | "TRADING" | "UPDATING_MODEL" | "ERROR";

const TRADING_BLOCKED_STATUSES: ReadonlySet<BotStatus> = new Set(["TRAINING", "UPDATING_MODEL"]);

export class BotBusyError extends Error {
  constructor(status: BotStatus, action: string) {
    super(`Bot is ${status} — refusing to ${action} while training/updating the model.`);
    this.name = "BotBusyError";
  }
}

export function canTrade(status: BotStatus): boolean {
  return !TRADING_BLOCKED_STATUSES.has(status);
}

// Throws BotBusyError instead of returning a boolean so call sites can't
// accidentally ignore the result — every route in this app converts a
// thrown BotBusyError into an HTTP 409.
export function assertCanTrade(status: BotStatus, action: string): void {
  if (!canTrade(status)) {
    throw new BotBusyError(status, action);
  }
}
