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
