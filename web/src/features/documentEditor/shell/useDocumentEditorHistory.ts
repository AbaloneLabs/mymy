import { useState } from "react";
import {
  applyEditorOperations,
  coalesceEditorOperationEntries,
  createEditorOperationEntry,
  type EditorOperationEntry,
} from "@/features/documentEditor/shared/operationHistory";

const MAX_HISTORY_ENTRIES = 100;
const MAX_HISTORY_BYTES = 5_000_000;

interface EditorHistory {
  past: EditorOperationEntry[];
  future: EditorOperationEntry[];
}

export interface EditorHistoryTransition {
  model: unknown;
  key: string;
}

/**
 * Own document operation history independently from persistence state.
 *
 * Undo and interaction cancellation are different concepts: this coordinator
 * handles explicit history commands, while a modal/drag interaction should
 * keep its own pre-interaction snapshot and dispatch that snapshot on cancel.
 */
export function useDocumentEditorHistory() {
  const [history, setHistory] = useState<EditorHistory>({
    past: [],
    future: [],
  });

  function commit(
    currentModel: unknown,
    currentKey: string,
    nextModel: unknown,
  ): EditorHistoryTransition | null {
    const operation = createEditorOperationEntry({
      before: currentModel,
      after: nextModel,
      label: "Edit document model",
    });
    if (!operation) return null;
    const nextKey = `local:${operation.id}`;
    operation.beforeRevisionKey = currentKey;
    operation.afterRevisionKey = nextKey;
    const previous = history.past.at(-1);
    const previewCoalesced = previous
      ? coalesceEditorOperationEntries(previous, operation)
      : undefined;
    const committedKey =
      previewCoalesced === null
        ? (previous?.beforeRevisionKey ?? nextKey)
        : nextKey;
    setHistory((current) => {
      const currentPrevious = current.past.at(-1);
      const coalesced = currentPrevious
        ? coalesceEditorOperationEntries(currentPrevious, operation)
        : undefined;
      const past =
        coalesced === undefined
          ? [...current.past, operation]
          : coalesced === null
            ? current.past.slice(0, -1)
            : [...current.past.slice(0, -1), coalesced];
      return { past: trimHistoryEntries(past), future: [] };
    });
    return { model: nextModel, key: committedKey };
  }

  function undo(currentModel: unknown): EditorHistoryTransition | null {
    const previous = history.past.at(-1);
    if (!previous) return null;
    const model = applyEditorOperations(currentModel, previous.inverse);
    setHistory({
      past: history.past.slice(0, -1),
      future: trimHistoryEntries([previous, ...history.future], "start"),
    });
    return {
      model,
      key: previous.beforeRevisionKey ?? `undo:${previous.id}`,
    };
  }

  function redo(currentModel: unknown): EditorHistoryTransition | null {
    const next = history.future[0];
    if (!next) return null;
    const model = applyEditorOperations(currentModel, next.forward);
    setHistory({
      past: trimHistoryEntries([...history.past, next]),
      future: history.future.slice(1),
    });
    return {
      model,
      key: next.afterRevisionKey ?? `redo:${next.id}`,
    };
  }

  return {
    operationCount: history.past.length,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    commit,
    undo,
    redo,
    reset: () => setHistory({ past: [], future: [] }),
  };
}

function trimHistoryEntries(
  entries: EditorOperationEntry[],
  keep: "end" | "start" = "end",
) {
  const next =
    keep === "end"
      ? entries.slice(-MAX_HISTORY_ENTRIES)
      : entries.slice(0, MAX_HISTORY_ENTRIES);
  let totalSize = next.reduce((sum, entry) => sum + entry.size, 0);
  while (next.length > 1 && totalSize > MAX_HISTORY_BYTES) {
    const removed = keep === "end" ? next.shift() : next.pop();
    totalSize -= removed?.size ?? 0;
  }
  return next;
}
