import crypto from "crypto";

// Generic hashed-bearer-token helpers for server-to-server callers that
// have no Supabase user session — the ephemeral training VM
// (POST /api/train/cloud/callback) and a deployed bot's own freqtrade
// instance (POST /api/bots/[id]/status) both identify themselves this way.
// Only the sha256 hash is ever persisted; the raw token exists only in
// memory here and inside that one VM's cloud-init user-data.

export function generateCallbackToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashCallbackToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// The training VM has no jobId to present — the token itself is the lookup
// key (hash it, then find the job by that hash's unique index). This is the
// standard hashed-API-key pattern; a DB unique-index lookup doesn't leak the
// byte-by-byte timing signal a manual comparison loop would.
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer (.+)$/);
  return match ? match[1] : null;
}

// For the few call sites that look a record up by id first and must then
// compare a presented token's hash against one specific stored hash (rather
// than doing a hash-keyed DB lookup) — a manual `===` on hex strings would
// short-circuit at the first differing character.
export function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
