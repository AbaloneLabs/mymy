/**
 * Apply the canonical Decision project scope without disturbing other URL
 * filters. Keeping this transition transport-independent makes TopBar, page
 * filters, redirects, and browser history share one exact representation.
 */
export function setDecisionProjectScope(
  params: URLSearchParams,
  projectId: string | null,
) {
  if (projectId) {
    params.set("scope", "project");
    params.set("project", projectId);
  } else {
    params.set("scope", "all");
    params.delete("project");
  }
}

export function removeUnavailableDecisionScopes(
  params: URLSearchParams,
  availableAgents: ReadonlySet<string>,
  availableProjects: ReadonlySet<string>,
) {
  const agent = params.get("agent");
  const project = params.get("scope") === "project" ? params.get("project") : null;
  const agentRemoved = Boolean(agent && !availableAgents.has(agent));
  const projectRemoved = Boolean(project && !availableProjects.has(project));
  if (agentRemoved) params.delete("agent");
  if (projectRemoved) setDecisionProjectScope(params, null);
  return { agentRemoved, projectRemoved };
}
