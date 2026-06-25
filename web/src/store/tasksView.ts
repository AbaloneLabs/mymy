import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Tasks view-mode store.
 *
 * Persists the user's preferred Tasks page layout (list vs board) to
 * localStorage so it survives page refreshes. Matches the "switch view
 * mode on demand" UX requirement.
 *
 * Default: "list" (mobile-friendly; board is wider and scrolls
 * horizontally on small screens).
 */
export type TasksView = "list" | "board";

interface TasksViewState {
  view: TasksView;
  setView: (view: TasksView) => void;
}

export const useTasksViewStore = create<TasksViewState>()(
  persist(
    (set) => ({
      view: "list",
      setView: (view) => set({ view }),
    }),
    { name: "mymy-tasks-view" },
  ),
);
