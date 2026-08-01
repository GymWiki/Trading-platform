import { Prisma } from "@prisma/client";
import type { BotConfigurationDTO } from "@/lib/types";

// Shared Prisma `select` for every route/page that returns a bot to the
// client, so the DTO shape (including the latest training job) stays
// consistent across GET/POST /api/bots, PATCH /api/bots/[id], and the
// dashboard server component.
export const botSelect = {
  id: true,
  botName: true,
  exchangeName: true,
  strategy: true,
  strategyCode: true,
  pairWhitelist: true,
  stakeAmount: true,
  isPaperTrading: true,
  deploymentStatus: true,
  aiModelPath: true,
  hetznerServerIp: true,
  apiServerUsername: true,
  status: true,
  lastError: true,
  trainingMode: true,
  createdAt: true,
  trainingJobs: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true,
      status: true,
      mode: true,
      errorMessage: true,
      createdAt: true,
    },
  },
} satisfies Prisma.BotConfigurationSelect;

type BotWithTrainingJobs = Prisma.BotConfigurationGetPayload<{ select: typeof botSelect }>;

// Flattens the `trainingJobs: [latest]` array (from `take: 1`) into a
// single `latestTrainingJob` field for the client-facing DTO.
export function toBotDTO(bot: BotWithTrainingJobs): BotConfigurationDTO {
  const { trainingJobs, ...rest } = bot;
  return { ...rest, latestTrainingJob: trainingJobs[0] ?? null };
}
