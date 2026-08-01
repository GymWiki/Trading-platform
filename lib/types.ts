export type DeploymentStatus = "LOCAL" | "VPS_ACTIVE" | "INACTIVE";
export type TrainingMode = "LOCAL" | "CLOUD";
export type TrainingStatus = "QUEUED" | "TRAINING" | "COMPLETED" | "FAILED";

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
  pairWhitelist: string;
  stakeAmount: number;
  isPaperTrading: boolean;
  deploymentStatus: DeploymentStatus;
  aiModelPath: string | null;
  hetznerServerIp: string | null;
  trainingMode: TrainingMode;
  latestTrainingJob: TrainingJobDTO | null;
  createdAt: string | Date;
}
