import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { withErrorHandling } from "@/lib/api-handler";

export const DELETE = withErrorHandling(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connection = await prisma.exchangeConnection.findUnique({ where: { id: params.id } });
  if (!connection || connection.userId !== user.id) {
    return NextResponse.json({ error: "Platform not found" }, { status: 404 });
  }

  // BotConfiguration.exchangeConnectionId is onDelete: Restrict — this
  // check exists purely to turn that hard DB error into a clear message
  // before we even try, so the user knows which bots to remove/relink
  // first instead of seeing a raw constraint-violation failure.
  const botsUsingConnection = await prisma.botConfiguration.count({ where: { exchangeConnectionId: connection.id } });
  if (botsUsingConnection > 0) {
    return NextResponse.json(
      { error: `Kan niet verwijderen: ${botsUsingConnection} bot(s) gebruiken dit platform nog.` },
      { status: 409 },
    );
  }

  try {
    await prisma.exchangeConnection.delete({ where: { id: connection.id } });
  } catch (err) {
    // Defense in depth against the count-then-delete race above (a bot
    // could theoretically be created against this connection in between):
    // P2003 is Prisma's foreign key constraint violation, P2025 is "record
    // to delete does not exist" (already gone). Both are real, expected
    // outcomes here, not bugs — surface them as normal 4xx responses
    // instead of letting withErrorHandling turn them into a generic 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2003") {
        return NextResponse.json(
          { error: "Kan niet verwijderen: dit platform wordt nog door een bot gebruikt." },
          { status: 409 },
        );
      }
      if (err.code === "P2025") {
        return NextResponse.json({ error: "Platform not found" }, { status: 404 });
      }
    }
    throw err;
  }

  return NextResponse.json({ success: true });
});
