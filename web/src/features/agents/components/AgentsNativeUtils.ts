import type { Agent } from "@/types/agents";

export function profileFromAgent(agent: Agent): string {
  return agent.profile;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
