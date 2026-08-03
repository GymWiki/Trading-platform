import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// DATABASE_URL must point at Supabase's PgBouncer pooler (port 6543) with
// pgbouncer=true — without it, Prisma's prepared-statement caching collides
// across the connection reuse a serverless platform does under the hood,
// surfacing as Postgres error 42P05 "prepared statement already exists"
// (seen in production on /api/platforms — see git history). .env.example
// documents the right value, but a misconfigured Vercel env var can't be
// caught at build time since neither `tsc` nor `next build` ever opens a
// real DB connection. Enforced here in code, defense-in-depth on top of
// getting the env var itself right, so a wrong/missing param on the
// deployed value can't reintroduce this bug silently.
function poolableDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    if (!url.searchParams.has("pgbouncer")) {
      url.searchParams.set("pgbouncer", "true");
    }
    return url.toString();
  } catch {
    // Malformed URL — let Prisma's own validation surface the real error
    // rather than masking it with a silent fallback here.
    return raw;
  }
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: poolableDatabaseUrl() } },
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
