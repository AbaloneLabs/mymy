import type { PptxModel } from "../shared/models";

export type PptxPendingInsertion = {
  id: string;
  label: string;
  cancel: () => void;
};

/**
 * FileReader and image decoding complete outside React's event that started
 * them. This coordinator owns a current model cursor so two completions can be
 * applied sequentially without either callback writing the stale model it
 * originally captured.
 */
export function createPptxAsyncInsertionCoordinator({
  initialModel,
  onCommit,
  onPendingChange,
  onResult,
}: {
  initialModel: PptxModel;
  onCommit: (model: PptxModel) => void;
  onPendingChange: (operations: PptxPendingInsertion[]) => void;
  onResult: (message: string | null) => void;
}) {
  let currentModel = initialModel;
  let commit = onCommit;
  let pending: PptxPendingInsertion[] = [];
  let sequence = 0;

  return {
    sync(model: PptxModel, nextCommit: (model: PptxModel) => void) {
      currentModel = model;
      commit = nextCommit;
    },
    applyLatest(updater: (model: PptxModel) => PptxModel) {
      const next = updater(currentModel);
      if (next === currentModel) return false;
      currentModel = next;
      commit(next);
      return true;
    },
    register(label: string, cancel: () => void) {
      sequence += 1;
      const operation = { id: `pptx-insert-${sequence}`, label, cancel };
      pending = [...pending, operation];
      onPendingChange(pending);
      onResult(null);
      return operation.id;
    },
    finish(id: string, result?: string) {
      pending = pending.filter((operation) => operation.id !== id);
      onPendingChange(pending);
      if (result) onResult(result);
    },
    cancelAll() {
      const operations = pending;
      pending = [];
      operations.forEach((operation) => operation.cancel());
      onPendingChange([]);
    },
  };
}
