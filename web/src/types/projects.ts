import type { GitSystemType } from "./settings";


export interface Project {
  id: string;
  name: string;
  description?: string;

  gitRemote?: string;

  gitSystem?: GitSystemType;

  status: "active" | "archived";

  agentCount?: number;

  createdAt?: string;

  updatedAt?: string;
}
