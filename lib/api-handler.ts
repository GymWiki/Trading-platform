import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";

type RouteHandler<Args extends unknown[]> = (...args: Args) => Promise<NextResponse>;

// Wraps a Next.js Route Handler so ANY uncaught exception — a bug in our
// own code, a network failure to Hetzner/CCXT/Supabase that slipped past
// a narrower try/catch, anything — still comes back as JSON instead of
// Next.js's default HTML error page. Every route below still does its own
// specific error handling (400s, 404s, 409s, 502s); this is the backstop
// that guarantees the *shape* of a response even when something truly
// unexpected happens, since a frontend that awaits res.json() (see
// lib/api-client.ts for the matching frontend-side fix) would otherwise
// crash on "Unexpected end of JSON input" or choke on a stray HTML page.
export function withErrorHandling<Args extends unknown[]>(handler: RouteHandler<Args>): RouteHandler<Args> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      const req = args[0] instanceof NextRequest ? args[0] : undefined;
      const label = req ? `${req.method} ${req.nextUrl.pathname}` : "route handler";
      console.error(`[API] Unhandled error in ${label}:`, err);
      const details = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: "Internal Server Error", details }, { status: 500 });
    }
  };
}

// Shared JSON-body validator: parses with Zod and returns a typed value on
// success or a ready-to-return 400 NextResponse on failure, so every route
// gets the same "reject malformed input at the boundary" behavior instead
// of ad-hoc `typeof x !== "string"` checks scattered per field. Route-
// specific business rules (closed-list checks, Python-identifier safety,
// etc.) still run as a second pass after this succeeds — Zod validates
// shape/type, not domain rules.
export async function parseJsonBody<T>(
  req: NextRequest,
  schema: ZodSchema<T>,
): Promise<{ data: T } | { error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { error: NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 }) };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      error: NextResponse.json(
        {
          error: "Invalid request body",
          details: formatZodError(result.error),
        },
        { status: 400 },
      ),
    };
  }
  return { data: result.data };
}

function formatZodError(err: ZodError): string {
  return err.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
}
