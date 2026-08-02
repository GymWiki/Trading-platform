import type { FreqAIProfileConfig } from "@/lib/strategy-presets";

export type DeploymentStatus = "LOCAL" | "VPS_ACTIVE" | "INACTIVE";
export type TrainingMode = "LOCAL" | "CLOUD";
export type TrainingStatus = "QUEUED" | "TRAINING" | "COMPLETED" | "FAILED";
export type BotStatus = "IDLE" | "TRAINING" | "TRADING" | "UPDATING_MODEL" | "ERROR";

export interface TrainingJobDTO {
  id: string;
  status: TrainingStatus;
  mode: TrainingMode;
  errorMessage: string | null;
  createdAt: string | Date;
}

export interface BotConfigurationDTO {
  id: string;
  botName: string;
  exchangeName: string;
  strategy: string;
  strategyCode: string;
  freqaiConfig: FreqAIProfileConfig;
  autoSelectCoins: boolean;
  pairWhitelist: string | null;
  totalBudget: number;
  maxStakePercentage: number;
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
