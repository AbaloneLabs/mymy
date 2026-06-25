import { create } from "zustand";

/**
 * Context create-action bus.
 *
 * Global shortcuts (e.g. pressing `N` for "new note") and command palette
 * "create" commands both call `triggerCreate(actionId)`. Feature pages
 * (Notes, Tasks, Calendar, Chat) subscribe via `subscribe` to open their
 * creation forms in response.
 *
 * This is session-only, in-memory state — it is an event channel, not
 * persisted data.
 */

interface CreateBusState {
  /** Monotonically increasing counter; increments on each trigger. */
  nonce: number;
  /** The action id of the last trigger (e.g. "create.note"). */
  lastAction: string | null;
  /** Emit a create action. */
  triggerCreate: (actionId: string) => void;
}

export const useCreateBus = create<CreateBusState>((set) => ({
  nonce: 0,
  lastAction: null,
  triggerCreate: (actionId) =>
    set((s) => ({ nonce: s.nonce + 1, lastAction: actionId })),
}));
