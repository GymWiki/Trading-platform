// A bot's `strategy` field doubles as a Python class name AND a filesystem
// path segment (user_data/strategies/<strategy>.py) once it reaches
// cloud-init, so it's validated once here at the API boundary — the
// earliest point untrusted input enters the system — and again defensively
// inside lib/hetzner.ts right before it's used as a path.
export const PYTHON_IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export const MAX_STRATEGY_CODE_LENGTH = 100_000;

export function isSafePythonIdentifier(value: string): boolean {
  return PYTHON_IDENTIFIER_REGEX.test(value);
}

// Light sanity check, not a Python parser: catches the common mistake of
// pasting the wrong file or a class with a different name before it ever
// reaches a VPS, without pretending to fully validate the source.
export function strategyCodeDefinesClass(code: string, className: string): boolean {
  return new RegExp(`class\\s+${className}\\b`).test(code);
}

// Structural check for the FreqAIProfileConfig JSON blob (see
// lib/strategy-presets.ts) — every bot carries one, and lib/hetzner.ts
// trusts its shape when building the freqai config.json block, so malformed
// input needs to be rejected here rather than surface as a cryptic
// cloud-init failure later.
export function isValidFreqAIConfig(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const config = value as Record<string, unknown>;

  if (typeof config.freqaiModel !== "string" || !config.freqaiModel) return false;

  const training = config.training as Record<string, unknown> | undefined;
  if (
    typeof training !== "object" ||
    training === null ||
    typeof training.trainPeriodDays !== "number" ||
    typeof training.backtestPeriodDays !== "number" ||
    typeof training.liveRetrainHours !== "number"
  ) {
    return false;
  }

  const features = config.features as Record<string, unknown> | undefined;
  if (
    typeof features !== "object" ||
    features === null ||
    typeof features.baseTimeframe !== "string" ||
    !features.baseTimeframe ||
    !Array.isArray(features.indicatorPeriods) ||
    !features.indicatorPeriods.every((p) => typeof p === "number") ||
    !Array.isArray(features.includeTimeframes) ||
    !features.includeTimeframes.every((t) => typeof t === "string") ||
    typeof features.labelPeriodCandles !== "number"
  ) {
    return false;
  }

  const risk = config.risk as Record<string, unknown> | undefined;
  if (
    typeof risk !== "object" ||
    risk === null ||
    typeof risk.stoploss !== "number" ||
    typeof risk.minimalRoi !== "object" ||
    risk.minimalRoi === null ||
    typeof risk.trailingStop !== "boolean"
  ) {
    return false;
  }

  if (config.positionAdjustment !== undefined) {
    const pa = config.positionAdjustment as Record<string, unknown>;
    if (
      typeof pa !== "object" ||
      pa === null ||
      typeof pa.enabled !== "boolean" ||
      typeof pa.maxEntryPositionAdjustment !== "number" ||
      typeof pa.rebuyTriggerPercent !== "number"
    ) {
      return false;
    }
  }

  return true;
}
