export type DeploymentStatus = "LOCAL" | "VPS_ACTIVE" | "INACTIVE";

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
  createdAt: string | Date;
}
