import {
  Activity,
  Bot,
  Clock,
  MessageSquare,
  Brain,
  ShieldQuestion,
  ScrollText,
  Users,
} from "lucide-react";

export type AgentsTab =
  | "agents"
  | "overview"
  | "jobs"
  | "decisions"
  | "memory"
  | "sessions"
  | "prompt";

export const ALL_AGENT_TABS: AgentsTab[] = [
  "overview",
  "agents",
  "sessions",
  "decisions",
  "memory",
  "jobs",
];

export const SINGLE_AGENT_TABS: AgentsTab[] = [
  "overview",
  "sessions",
  "decisions",
  "memory",
  "jobs",
  "prompt",
];

export const TAB_ICONS: Record<AgentsTab, typeof Bot> = {
  agents: Users,
  overview: Activity,
  jobs: Clock,
  sessions: MessageSquare,
  decisions: ShieldQuestion,
  memory: Brain,
  prompt: ScrollText,
};
