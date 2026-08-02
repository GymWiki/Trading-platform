import type { FreqAIProfileConfig } from "@/lib/strategy-presets";

export type DeploymentStatus = "LOCAL" | "VPS_ACTIVE" | "INACTIVE";
export type TrainingMode = "LOCAL" | "CLOUD";
export type TrainingStatus = "QUEUED" | "TRAINING" | "COMPLETED" | "FAILED";
// "Try before you risk": every bot is born (and stays) in
// TRAINING_PAPER_TRADE until it clears the Go Live flow — see the enum
// doc comment in prisma/schema.prisma for the full state machine.
export type BotStatus = "TRAINING_PAPER_TRADE" | "TRAINING" | "LIVE_TRADING" | "UPDATING_MODEL" | "ERROR";

export interface TrainingJobDTO {
  id: string;
  status: TrainingStatus;
  mode: TrainingMode;
  errorMessage: string | null;
  createdAt: string | Date;
}

export interface ExchangeConnectionDTO {
  id: string;
  exchangeName: string;
  isActive: boolean;
  createdAt: string | Date;
}

export interface BotConfigurationDTO {
  id: string;
  botName: string;
  exchangeConnectionId: string;
  exchangeName: string;
  strategy: string;
  strategyCode: string;
  freqaiConfig: FreqAIProfileConfig;
  autoSelectCoins: boolean;
  pairWhitelist: string | null;
  totalBudget: number | null;
  maxStakePercentage: number | null;
  isPaperTrading: boolean;
  deploymentStatus: DeploymentStatus;
  aiModelPath: string | null;
  hetznerServerIp: string | null;
  apiServerUsername: string | null;
  status: BotStatus;
  lastError: string | null;
  trainingMode: TrainingMode;
  latestTrainingJob: TrainingJobDTO | null;
  createdAt: string | Date;
}
