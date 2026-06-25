import { create } from "zustand";

/**
 * Project + Agent context store — session-memory only (not persisted).
 *
 * Tracks the currently selected project and agent in the global TopBar
 * dropdowns. This is a working context (not a permanent setting), so it
 * resets on refresh. Pages filter their data by these values:
 *   - Chat: filters sessions by both project + agent profile
 *   - Calendar: filters events by project only (agent is a no-op)
 *
 * `selectedProjectId === null` means "All Projects" (no filter).
 * `selectedAgentProfile === null` means "All Agents" (no filter).
 */
interface ProjectContextState {

  selectedProjectId: string | null;

  selectedAgentProfile: string | null;

  setSelectedProjectId: (id: string | null) => void;

  setSelectedAgentProfile: (profile: string | null) => void;
}

export const useProjectContext = create<ProjectContextState>((set) => ({
  selectedProjectId: null,
  selectedAgentProfile: null,
  setSelectedProjectId: (id) => set({ selectedProjectId: id }),
  setSelectedAgentProfile: (profile) => set({ selectedAgentProfile: profile }),
}));
