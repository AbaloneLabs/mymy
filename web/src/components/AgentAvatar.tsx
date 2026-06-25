import { cn } from "@/lib/utils";
import type { Agent } from "@/types/agents";

interface AgentAvatarProps {
  agent: Pick<Agent, "name" | "avatarUrl">;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE = {
  sm: "h-8 w-8 text-sm",
  md: "h-10 w-10 text-base",
  lg: "h-14 w-14 text-xl",
};


export function AgentAvatar({ agent, size = "md", className }: AgentAvatarProps) {
  const initial = agent.name.trim().charAt(0).toUpperCase() || "?";

  if (agent.avatarUrl) {
    return (
      <img
        src={agent.avatarUrl}
        alt={agent.name}
        className={cn("rounded-full object-cover", SIZE[size], className)}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full font-semibold text-white",
        "bg-gradient-to-br from-[var(--accent-from)] to-[var(--accent-to)]",
        SIZE[size],
        className
      )}
      aria-label={agent.name}
    >
      {initial}
    </div>
  );
}
