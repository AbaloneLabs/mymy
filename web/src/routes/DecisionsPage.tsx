import { useEffect, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { DecisionsInbox } from "@/features/decisions/DecisionsInbox";
import {
  removeUnavailableDecisionScopes,
  setDecisionProjectScope,
} from "@/features/decisions/urlState";
import type {
  DecisionFilters,
  DecisionKind,
  DecisionStatus,
} from "@/features/decisions/api";
import { useAgents } from "@/features/agents/api";
import { useProjects } from "@/features/projects/api";
import { useProjectContext } from "@/store/projectContext";

const STATUSES = [
  "pending",
  "resolved",
  "dismissed",
  "expired",
  "cancelled",
  "superseded",
] as const;
const KINDS = ["choice", "input"] as const;

export default function DecisionsPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const agents = useAgents();
  const projects = useProjects();
  const selectedAgentProfile = useProjectContext((state) => state.selectedAgentProfile);
  const selectedProjectId = useProjectContext((state) => state.selectedProjectId);
  const setSelectedAgentProfile = useProjectContext((state) => state.setSelectedAgentProfile);
  const setSelectedProjectId = useProjectContext((state) => state.setSelectedProjectId);
  const observedTopBarAgent = useRef(selectedAgentProfile);
  const observedTopBarProject = useRef(selectedProjectId);
  const scopeAnnouncementKey = (
    location.state as { decisionScopeAnnouncement?: string } | null
  )?.decisionScopeAnnouncement;
  const scopeAnnouncement = scopeAnnouncementKey ? t(scopeAnnouncementKey) : "";

  const statusParam = searchParams.get("status");
  const status = STATUSES.includes(statusParam as DecisionStatus)
    ? (statusParam as DecisionStatus)
    : "pending";
  const kindParam = searchParams.get("kind");
  const kind = KINDS.includes(kindParam as DecisionKind)
    ? (kindParam as DecisionKind)
    : undefined;
  const blockingParam = searchParams.get("blocking");
  const blocking =
    blockingParam === "true" ? true : blockingParam === "false" ? false : undefined;
  const urlAgent = searchParams.get("agent");
  const urlProject = searchParams.get("project");
  const scopeParam = searchParams.get("scope");
  const projectScope = scopeParam === "project" && Boolean(urlProject);
  const effectiveAgent = urlAgent;
  const effectiveProject = projectScope ? urlProject : null;
  const focusedDecisionId = searchParams.get("decisionId");
  const filters: DecisionFilters = {
    status,
    kind,
    blocking,
    agentProfile: effectiveAgent ?? undefined,
    projectId: effectiveProject ?? undefined,
  };

  useLayoutEffect(() => {
    if (scopeParam !== "all" && scopeParam !== "project") {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (selectedProjectId) {
          next.set("scope", "project");
          next.set("project", selectedProjectId);
        } else {
          next.set("scope", "all");
          next.delete("project");
        }
        return next;
      }, { replace: true });
      return;
    }

    const agentChangedInTopBar = observedTopBarAgent.current !== selectedAgentProfile;
    const projectChangedInTopBar = observedTopBarProject.current !== selectedProjectId;
    observedTopBarAgent.current = selectedAgentProfile;
    observedTopBarProject.current = selectedProjectId;
    if (agentChangedInTopBar || projectChangedInTopBar) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (agentChangedInTopBar) {
          setOptionalParam(next, "agent", selectedAgentProfile);
        }
        if (projectChangedInTopBar) {
          setDecisionProjectScope(next, selectedProjectId);
        }
        return next;
      });
      return;
    }

    if (selectedAgentProfile !== urlAgent) {
      observedTopBarAgent.current = urlAgent;
      setSelectedAgentProfile(urlAgent);
    }
    if (projectScope && selectedProjectId !== urlProject) {
      observedTopBarProject.current = urlProject;
      setSelectedProjectId(urlProject);
    }
  }, [
    projectScope,
    scopeParam,
    selectedAgentProfile,
    selectedProjectId,
    setSelectedAgentProfile,
    setSelectedProjectId,
    urlAgent,
    urlProject,
    setSearchParams,
  ]);

  useEffect(() => {
    if (!agents.isSuccess || !projects.isSuccess) return;
    const next = new URLSearchParams(searchParams);
    const change = removeUnavailableDecisionScopes(
      next,
      new Set((agents.data?.agents ?? []).map((agent) => agent.profile)),
      new Set((projects.data?.projects ?? []).map((project) => project.id)),
    );
    if (!change.agentRemoved && !change.projectRemoved) return;
    if (change.agentRemoved) setSelectedAgentProfile(null);
    if (change.projectRemoved) setSelectedProjectId(null);
    const announcementKey =
      change.agentRemoved && change.projectRemoved
        ? "decisions.agentAndProjectScopeRemoved"
        : change.agentRemoved
          ? "decisions.agentScopeRemoved"
          : "decisions.projectScopeRemoved";
    setSearchParams(next, {
      replace: true,
      state: { decisionScopeAnnouncement: announcementKey },
    });
  }, [
    agents.data,
    agents.isSuccess,
    projects.data,
    projects.isSuccess,
    searchParams,
    setSearchParams,
    setSelectedAgentProfile,
    setSelectedProjectId,
  ]);

  function updateParam(name: string, value: string | null) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      setOptionalParam(next, name, value);
      return next;
    });
  }

  function updateProject(value: string) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      setDecisionProjectScope(next, value || null);
      return next;
    });
  }

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
          <header>
            <h1 className="text-xl font-semibold text-[var(--text)]">{t("decisions.title")}</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{t("decisions.description")}</p>
          </header>

          {scopeAnnouncement && (
            <div
              role="status"
              className="mt-4 rounded-md border border-[var(--status-warning)]/30 bg-[var(--status-warning-bg)] px-3 py-2 text-xs text-[var(--status-warning)]"
            >
              {scopeAnnouncement}
            </div>
          )}

          <div className="my-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5" aria-label={t("decisions.filters")}>
            <FilterSelect
              label={t("decisions.filterStatus")}
              value={status}
              onChange={(value) => updateParam("status", value === "pending" ? null : value)}
            >
              {STATUSES.map((value) => (
                <option key={value} value={value}>{t(`decisions.status.${value}`)}</option>
              ))}
            </FilterSelect>
            <FilterSelect
              label={t("decisions.filterKind")}
              value={kind ?? ""}
              onChange={(value) => updateParam("kind", value || null)}
            >
              <option value="">{t("common.all")}</option>
              {KINDS.map((value) => (
                <option key={value} value={value}>{t(`decisions.kind.${value}`)}</option>
              ))}
            </FilterSelect>
            <FilterSelect
              label={t("decisions.filterBlocking")}
              value={blocking === undefined ? "" : String(blocking)}
              onChange={(value) => updateParam("blocking", value || null)}
            >
              <option value="">{t("common.all")}</option>
              <option value="true">{t("decisions.blockingOnly")}</option>
              <option value="false">{t("decisions.nonBlockingOnly")}</option>
            </FilterSelect>
            <FilterSelect
              label={t("decisions.filterAgent")}
              value={effectiveAgent ?? ""}
              onChange={(value) => updateParam("agent", value || null)}
            >
              <option value="">{t("nav.allAgents")}</option>
              {(agents.data?.agents ?? []).map((agent) => (
                <option key={agent.profile} value={agent.profile}>{agent.name}</option>
              ))}
            </FilterSelect>
            <FilterSelect
              label={t("decisions.filterProject")}
              value={effectiveProject ?? ""}
              onChange={updateProject}
            >
              <option value="">{t("chat.allProjects")}</option>
              {(projects.data?.projects ?? []).map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </FilterSelect>
          </div>

          <DecisionsInbox filters={filters} focusedDecisionId={focusedDecisionId} />
        </div>
      </div>
    </AppLayout>
  );
}

function setOptionalParam(params: URLSearchParams, name: string, value: string | null) {
  if (value) params.set(name, value);
  else params.delete(name);
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="space-y-1 text-[11px] text-[var(--text-faint)]">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)]"
      >
        {children}
      </select>
    </label>
  );
}
