import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024; // 200MB

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const botId = formData.get("botId");
  const file = formData.get("file");

  if (typeof botId !== "string" || !botId) {
    return NextResponse.json({ error: "botId is required" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".joblib")) {
    return NextResponse.json({ error: "Only .joblib model files are accepted" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: "File exceeds 200MB limit" }, { status: 400 });
  }

  const bot = await prisma.botConfiguration.findUnique({ where: { id: botId } });
  if (!bot || bot.userId !== user.id) {
    return NextResponse.json({ error: "Bot not found" }, { status: 404 });
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", user.id, botId);
  await mkdir(uploadDir, { recursive: true });

  const safeFileName = `model-${Date.now()}.joblib`;
  const destination = path.join(uploadDir, safeFileName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(destination, buffer);

  const publicPath = `/uploads/${user.id}/${botId}/${safeFileName}`;

  const updated = await prisma.botConfiguration.update({
    where: { id: botId },
    data: { aiModelPath: publicPath },
  });

  return NextResponse.json({ aiModelPath: updated.aiModelPath });
}
