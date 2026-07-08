import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAgents, useUpdateAgent } from "@/features/agents/api";
import type {
  Agent,
  AgentToolAccess,
  AgentToolDomain,
  AgentToolPermission,
} from "@/types/agents";

const DOMAINS: AgentToolDomain[] = [
  "prompts",
  "memory",
  "sessions",
  "goals",
  "calendar",
  "tasks",
  "knowledge",
  "notes",
  "drive",
  "processes",
  "finance",
  "investments",
  "agents",
];

const ACCESS_VALUES: AgentToolAccess[] = ["access", "read_only", "denied"];

export function AgentToolPermissionsSection() {
  const { t } = useTranslation();
  const { data, isLoading } = useAgents();
  const updateAgent = useUpdateAgent();
  const agents = data?.agents ?? [];

  function changePermission(
    agent: Agent,
    domain: AgentToolDomain,
    access: AgentToolAccess,
  ) {
    const current = normalizePermissions(agent.toolPermissions ?? []);
    const next = current.map((permission) =>
      permission.domain === domain ? { ...permission, access } : permission,
    );
    updateAgent.mutate({
      profile: agent.profile,
      body: { toolPermissions: next },
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-[var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
        {t("settings.agentPermissions.loading")}
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
        {t("settings.agentPermissions.empty")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium text-[var(--text)]">
          {t("settings.agentPermissions.title")}
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {t("settings.agentPermissions.description")}
        </p>
      </div>

      <div className="space-y-3">
        {agents.map((agent) => {
          const permissions = normalizePermissions(agent.toolPermissions ?? []);
          const saving =
            updateAgent.isPending && updateAgent.variables?.profile === agent.profile;
          return (
            <section
              key={agent.profile}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)]"
            >
              <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--text)]">
                    {agent.name}
                  </div>
                  <div className="truncate font-mono text-[11px] text-[var(--text-faint)]">
                    {agent.profile}
                  </div>
                </div>
                {saving && (
                  <Loader2
                    className="h-4 w-4 animate-spin text-[var(--text-muted)]"
                    strokeWidth={1.75}
                  />
                )}
              </header>
              <div className="grid gap-x-3 gap-y-2 p-3 md:grid-cols-2 xl:grid-cols-3">
                {permissions.map((permission) => (
                  <label
                    key={permission.domain}
                    className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                  >
                    <span className="text-sm text-[var(--text)]">
                      {t(`settings.agentPermissions.domains.${permission.domain}`)}
                    </span>
                    <select
                      value={permission.access}
                      disabled={saving}
                      onChange={(event) =>
                        changePermission(
                          agent,
                          permission.domain,
                          event.target.value as AgentToolAccess,
                        )
                      }
                      className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                    >
                      {ACCESS_VALUES.map((access) => (
                        <option key={access} value={access}>
                          {t(`settings.agentPermissions.access.${access}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function normalizePermissions(
  permissions: AgentToolPermission[],
): AgentToolPermission[] {
  return DOMAINS.map((domain) => ({
    domain,
    access:
      permissions.find((permission) => permission.domain === domain)?.access ??
      defaultAccess(domain),
  }));
}

function defaultAccess(domain: AgentToolDomain): AgentToolAccess {
  return domain === "agents" || domain === "sessions" ? "read_only" : "access";
}
