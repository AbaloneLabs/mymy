import type { GitSystemType } from "./settings";


export interface Project {
  id: string;
  name: string;
  description?: string;

  gitRemote?: string;

  gitSystem?: GitSystemType;

  driveSlug: string;

  drivePath: string;

  status: "active" | "archived";

  agentCount?: number;

  createdAt?: string;

  updatedAt?: string;
}
