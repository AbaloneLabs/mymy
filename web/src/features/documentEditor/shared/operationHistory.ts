import { stableJson } from "./models";

export type EditorJsonPathSegment = string | number;

export type EditorModelOperation =
  | {
      kind: "add";
      path: EditorJsonPathSegment[];
      after: unknown;
    }
  | {
      kind: "remove";
      path: EditorJsonPathSegment[];
      before: unknown;
    }
  | {
      kind: "replace";
      path: EditorJsonPathSegment[];
      before: unknown;
      after: unknown;
    }
  | {
      kind: "text";
      path: EditorJsonPathSegment[];
      start: number;
      before: string;
      after: string;
    };

export interface EditorOperationEntry {
  id: string;
  label: string;
  timestamp: number;
  forward: EditorModelOperation[];
  inverse: EditorModelOperation[];
  size: number;
  beforeRevisionKey?: string;
  afterRevisionKey?: string;
}

const TEXT_OPERATION_GROUP_WINDOW_MS = 750;

const MAX_DIFF_OPERATIONS = 750;

/**
 * Document editors share one persistence shell, but their models differ by file
 * type. This operation layer records JSON-path changes instead of opaque
 * snapshots so undo/redo, conflict inspection, and future collaboration code can
 * reason about the same durable edit units without forcing every editor to adopt
 * the same internal data structure at once.
 */
export function createEditorOperationEntry({
  before,
  beforeKey,
  after,
  afterKey,
  label = "Edit",
}: {
  before: unknown;
  beforeKey?: string;
  after: unknown;
  afterKey?: string;
  label?: string;
}): EditorOperationEntry | null {
  if (Object.is(before, after)) return null;
  if (beforeKey !== undefined && afterKey !== undefined && beforeKey === afterKey) {
    return null;
  }
  const forward = diffEditorModels(before, after);
  if (forward.length === 0) return null;
  const inverse = invertEditorOperations(forward);
  return {
    id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
    label,
    timestamp: Date.now(),
    forward,
    inverse,
    beforeRevisionKey: beforeKey,
    afterRevisionKey: afterKey,
    // History retains only the changed paths and their inverse values. Keeping
    // complete serialized before/after models in every entry made a one-cell
    // edit consume memory proportional to the entire workbook.
    size: stableJson(forward).length + stableJson(inverse).length,
  };
}

export function applyEditorOperations(
  model: unknown,
  operations: EditorModelOperation[],
) {
  let draft = cloneJson(model);
  for (const operation of operations) {
    if (operation.path.length === 0) {
      draft =
        operation.kind === "remove"
          ? undefined
          : operation.kind === "text"
            ? applyTextOperation(draft, operation)
            : cloneJson(operation.after);
      continue;
    }
    applyEditorOperation(draft, operation);
  }
  return draft;
}

/**
 * Consecutive typing is one user intent, not one undo step per browser input
 * event. Text splices can be composed without retaining the complete model;
 * unrelated paths and edits outside the inserted span remain separate.
 */
export function coalesceEditorOperationEntries(
  previous: EditorOperationEntry,
  next: EditorOperationEntry,
): EditorOperationEntry | null | undefined {
  if (
    next.timestamp - previous.timestamp > TEXT_OPERATION_GROUP_WINDOW_MS ||
    previous.label !== next.label ||
    previous.forward.length !== 1 ||
    next.forward.length !== 1
  ) {
    return undefined;
  }
  const first = previous.forward[0];
  const second = next.forward[0];
  if (
    first.kind !== "text" ||
    second.kind !== "text" ||
    stableJson(first.path) !== stableJson(second.path)
  ) {
    return undefined;
  }
  const combined = coalesceTextOperations(first, second);
  if (!combined) return undefined;
  if (combined.before === combined.after) return null;
  const inverse: EditorModelOperation = {
    ...combined,
    before: combined.after,
    after: combined.before,
  };
  return {
    ...previous,
    timestamp: next.timestamp,
    forward: [combined],
    inverse: [inverse],
    size: stableJson(combined).length + stableJson(inverse).length,
    beforeRevisionKey: previous.beforeRevisionKey,
    afterRevisionKey: next.afterRevisionKey,
  };
}

function diffEditorModels(
  before: unknown,
  after: unknown,
  path: EditorJsonPathSegment[] = [],
  budget = { count: 0 },
): EditorModelOperation[] {
  // Editors preserve object identity for branches they did not touch. Checking
  // that identity first avoids recursively serializing an entire document at
  // every node of the diff. Independently cloned equal branches still compare
  // correctly by reaching equal primitive leaves.
  if (Object.is(before, after)) return [];
  if (budget.count > MAX_DIFF_OPERATIONS) {
    return [{ kind: "replace", path, before: cloneJson(before), after: cloneJson(after) }];
  }
  if (!isJsonContainer(before) || !isJsonContainer(after)) {
    budget.count += 1;
    if (typeof before === "string" && typeof after === "string") {
      return [createTextOperation(path, before, after)];
    }
    if (before === undefined) return [{ kind: "add", path, after: cloneJson(after) }];
    if (after === undefined) return [{ kind: "remove", path, before: cloneJson(before) }];
    return [
      {
        kind: "replace",
        path,
        before: cloneJson(before),
        after: cloneJson(after),
      },
    ];
  }
  if (Array.isArray(before) !== Array.isArray(after)) {
    budget.count += 1;
    return [{ kind: "replace", path, before: cloneJson(before), after: cloneJson(after) }];
  }
  const operations: EditorModelOperation[] = [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const maxLength = Math.max(before.length, after.length);
    for (let index = 0; index < maxLength; index += 1) {
      operations.push(
        ...diffEditorModels(before[index], after[index], [...path, index], budget),
      );
      if (budget.count > MAX_DIFF_OPERATIONS) break;
    }
    return maybeCollapseOperations(path, before, after, operations, budget);
  }
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
  Array.from(keys)
    .sort()
    .forEach((key) => {
      operations.push(
        ...diffEditorModels(beforeRecord[key], afterRecord[key], [...path, key], budget),
      );
    });
  return maybeCollapseOperations(path, before, after, operations, budget);
}

function maybeCollapseOperations(
  path: EditorJsonPathSegment[],
  before: unknown,
  after: unknown,
  operations: EditorModelOperation[],
  budget: { count: number },
) {
  if (operations.length > MAX_DIFF_OPERATIONS || budget.count > MAX_DIFF_OPERATIONS) {
    return [{ kind: "replace" as const, path, before: cloneJson(before), after: cloneJson(after) }];
  }
  return operations;
}

function invertEditorOperations(operations: EditorModelOperation[]) {
  return [...operations].reverse().map((operation): EditorModelOperation => {
    if (operation.kind === "add") {
      return { kind: "remove", path: operation.path, before: cloneJson(operation.after) };
    }
    if (operation.kind === "remove") {
      return { kind: "add", path: operation.path, after: cloneJson(operation.before) };
    }
    if (operation.kind === "text") {
      return {
        kind: "text",
        path: operation.path,
        start: operation.start,
        before: operation.after,
        after: operation.before,
      };
    }
    return {
      kind: "replace",
      path: operation.path,
      before: cloneJson(operation.after),
      after: cloneJson(operation.before),
    };
  });
}

function applyEditorOperation(model: unknown, operation: EditorModelOperation) {
  const parentPath = operation.path.slice(0, -1);
  const leaf = operation.path.at(-1);
  const parent = parentPath.reduce<unknown>((current, segment) => {
    if (current && typeof current === "object") {
      return (current as Record<string, unknown>)[String(segment)];
    }
    return undefined;
  }, model);
  if (parent === undefined || leaf === undefined) return;
  if (Array.isArray(parent) && typeof leaf === "number") {
    if (operation.kind === "remove") parent.splice(leaf, 1);
    else if (operation.kind === "add") parent.splice(leaf, 0, cloneJson(operation.after));
    else if (operation.kind === "text") {
      parent[leaf] = applyTextOperation(parent[leaf], operation);
    }
    else parent[leaf] = cloneJson(operation.after);
    return;
  }
  if (typeof parent !== "object" || parent === null) return;
  const record = parent as Record<string, unknown>;
  const key = String(leaf);
  if (operation.kind === "remove") delete record[key];
  else if (operation.kind === "text") {
    record[key] = applyTextOperation(record[key], operation);
  }
  else record[key] = cloneJson(operation.after);
}

function createTextOperation(
  path: EditorJsonPathSegment[],
  before: string,
  after: string,
): EditorModelOperation {
  let start = 0;
  const prefixLimit = Math.min(before.length, after.length);
  while (start < prefixLimit && before[start] === after[start]) start += 1;
  let suffix = 0;
  const suffixLimit = Math.min(before.length - start, after.length - start);
  while (
    suffix < suffixLimit &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) {
    suffix += 1;
  }
  return {
    kind: "text",
    path,
    start,
    before: before.slice(start, before.length - suffix),
    after: after.slice(start, after.length - suffix),
  };
}

function coalesceTextOperations(
  first: Extract<EditorModelOperation, { kind: "text" }>,
  second: Extract<EditorModelOperation, { kind: "text" }>,
) {
  const relativeStart = second.start - first.start;
  if (
    relativeStart >= 0 &&
    relativeStart + second.before.length <= first.after.length &&
    first.after.slice(
      relativeStart,
      relativeStart + second.before.length,
    ) === second.before
  ) {
    return {
      ...first,
      after: `${first.after.slice(0, relativeStart)}${second.after}${first.after.slice(relativeStart + second.before.length)}`,
    };
  }
  if (
    first.after.length === 0 &&
    second.after.length === 0 &&
    second.start === first.start
  ) {
    return { ...first, before: `${first.before}${second.before}` };
  }
  if (
    first.after.length === 0 &&
    second.after.length === 0 &&
    second.start + second.before.length === first.start
  ) {
    return {
      ...first,
      start: second.start,
      before: `${second.before}${first.before}`,
    };
  }
  return null;
}

function applyTextOperation(value: unknown, operation: Extract<EditorModelOperation, { kind: "text" }>) {
  if (typeof value !== "string") return value;
  const end = operation.start + operation.before.length;
  if (value.slice(operation.start, end) !== operation.before) return value;
  return `${value.slice(0, operation.start)}${operation.after}${value.slice(end)}`;
}

function isJsonContainer(value: unknown) {
  return typeof value === "object" && value !== null;
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
