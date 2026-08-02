// The state machine gating trading — paper or live. Every code path that
// could cause a bot to start or resume trading — /api/deploy, the Go Live
// flow (app/api/bots/[id]/golive), plus the resume step after a retrain
// finishes — must check this before doing anything. TRAINING and
// UPDATING_MODEL are the two statuses trading may never overlap with.
//
// "Try before you risk": every bot is born (and stays) in
// TRAINING_PAPER_TRADE until it clears Go Live — see the enum doc comment
// in prisma/schema.prisma for the full state machine.
export type BotStatus =
  | "TRAINING_PAPER_TRADE"
  | "TRAINING"
  | "LIVE_TRADING"
  | "UPDATING_MODEL"
  | "ERROR"
  | "PAUSED_EMERGENCY"
  | "SLEEPING";

// PAUSED_EMERGENCY and SLEEPING are just as blocking as TRAINING/
// UPDATING_MODEL: nothing (a retrain completing, a redeploy, Go Live)
// should ever silently resume a bot the user panic-stopped or that Sleep
// Mode paused for inactivity. Only POST /api/bots/[id]/resume — a
// deliberate user action — clears either one.
const TRADING_BLOCKED_STATUSES: ReadonlySet<BotStatus> = new Set([
  "TRAINING",
  "UPDATING_MODEL",
  "PAUSED_EMERGENCY",
  "SLEEPING",
]);

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
