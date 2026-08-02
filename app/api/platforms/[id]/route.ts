import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
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

  await prisma.exchangeConnection.delete({ where: { id: connection.id } });

  return NextResponse.json({ success: true });
}
