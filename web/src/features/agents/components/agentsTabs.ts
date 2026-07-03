import {
  Activity,
  Bot,
  Clock,
  MessageSquare,
  ScrollText,
  Users,
} from "lucide-react";

export type AgentsTab =
  | "agents"
  | "overview"
  | "jobs"
  | "sessions"
  | "prompt";

export const ALL_AGENT_TABS: AgentsTab[] = [
  "overview",
  "agents",
  "sessions",
  "jobs",
];

export const SINGLE_AGENT_TABS: AgentsTab[] = [
  "overview",
  "sessions",
  "jobs",
  "prompt",
];

export const TAB_ICONS: Record<AgentsTab, typeof Bot> = {
  agents: Users,
  overview: Activity,
  jobs: Clock,
  sessions: MessageSquare,
  prompt: ScrollText,
};
