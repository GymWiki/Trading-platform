import crypto from "crypto";

// The ephemeral training VM has no Supabase user session, so it identifies
// itself to POST /api/train/cloud/callback with a one-time bearer token
// instead. Only the sha256 hash is ever persisted — the raw token exists
// only in memory here and inside that one VM's cloud-init user-data.

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
