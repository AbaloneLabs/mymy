import {
  Activity,
  Bot,
  Brain,
  Clock,
  KeyRound,
  MessageSquare,
  Puzzle,
  UserCircle,
} from "lucide-react";

export type AgentsTab =
  | "overview"
  | "cron"
  | "sessions"
  | "skills"
  | "memory"
  | "identity"
  | "environment";

export const VALID_TABS: AgentsTab[] = [
  "overview",
  "cron",
  "sessions",
  "skills",
  "memory",
  "identity",
  "environment",
];

export const TAB_ICONS: Record<AgentsTab, typeof Bot> = {
  overview: Activity,
  cron: Clock,
  sessions: MessageSquare,
  skills: Puzzle,
  memory: Brain,
  identity: UserCircle,
  environment: KeyRound,
};
