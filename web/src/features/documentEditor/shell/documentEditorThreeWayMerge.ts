const MISSING = Symbol("missing");

type MergeValue = unknown | typeof MISSING;

export interface DocumentThreeWayComparison {
  mergedModel: unknown;
  conflictPaths: string[];
  localChangedPaths: string[];
  externalChangedPaths: string[];
}

/**
 * The browser draft and durable revision share a base model. This merge accepts
 * only changes whose ownership can be proven disjoint: different object keys,
 * stable array elements in unchanged order, or non-overlapping text splices.
 * Ambiguous structural edits remain local and are reported as conflicts for a
 * user decision instead of being guessed.
 */
export function compareAndMergeDocumentModels(
  base: unknown,
  local: unknown,
  external: unknown,
): DocumentThreeWayComparison {
  const result = mergeValue(base, local, external, "$", []);
  return {
    mergedModel: result.value === MISSING ? undefined : result.value,
    conflictPaths: uniquePaths(result.conflicts),
    localChangedPaths: changedModelPaths(base, local),
    externalChangedPaths: changedModelPaths(base, external),
  };
}

function mergeValue(
  base: MergeValue,
  local: MergeValue,
  external: MergeValue,
  path: string,
  conflicts: string[],
): { value: MergeValue; conflicts: string[] } {
  if (equalJson(local, external)) return { value: cloneValue(local), conflicts };
  if (equalJson(local, base)) return { value: cloneValue(external), conflicts };
  if (equalJson(external, base)) return { value: cloneValue(local), conflicts };

  if (
    typeof base === "string" &&
    typeof local === "string" &&
    typeof external === "string"
  ) {
    const merged = mergeIndependentTextChanges(base, local, external);
    if (merged !== null) return { value: merged, conflicts };
  }

  if (isJsonRecord(base) && isJsonRecord(local) && isJsonRecord(external)) {
    const output: Record<string, unknown> = {};
    const keys = new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(external),
    ]);
    for (const key of [...keys].sort()) {
      const merged = mergeValue(
        key in base ? base[key] : MISSING,
        key in local ? local[key] : MISSING,
        key in external ? external[key] : MISSING,
        `${path}.${escapePathSegment(key)}`,
        conflicts,
      );
      if (merged.value !== MISSING) output[key] = merged.value;
    }
    return { value: output, conflicts };
  }

  if (
    Array.isArray(base) &&
    Array.isArray(local) &&
    Array.isArray(external) &&
    stableArrayShape(base, local, external)
  ) {
    return {
      value: base.map((baseItem, index) =>
        mergeValue(
          baseItem,
          local[index],
          external[index],
          `${path}[${stableItemLabel(baseItem, index)}]`,
          conflicts,
        ).value,
      ),
      conflicts,
    };
  }

  conflicts.push(path);
  return { value: cloneValue(local), conflicts };
}

function mergeIndependentTextChanges(
  base: string,
  local: string,
  external: string,
) {
  const localChange = textChange(base, local);
  const externalChange = textChange(base, external);
  const separate =
    localChange.end <= externalChange.start ||
    externalChange.end <= localChange.start;
  const sameInsertionPoint =
    localChange.start === localChange.end &&
    externalChange.start === externalChange.end &&
    localChange.start === externalChange.start;
  if (!separate || sameInsertionPoint) return null;
  return [localChange, externalChange]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, change) =>
        `${current.slice(0, change.start)}${change.insert}${current.slice(change.end)}`,
      base,
    );
}

function textChange(base: string, value: string) {
  let start = 0;
  while (start < base.length && start < value.length && base[start] === value[start]) {
    start += 1;
  }
  let suffix = 0;
  while (
    suffix < base.length - start &&
    suffix < value.length - start &&
    base[base.length - suffix - 1] === value[value.length - suffix - 1]
  ) {
    suffix += 1;
  }
  return {
    start,
    end: base.length - suffix,
    insert: value.slice(start, value.length - suffix),
  };
}

function stableArrayShape(base: unknown[], local: unknown[], external: unknown[]) {
  if (base.length !== local.length || base.length !== external.length) return false;
  return base.every((item, index) => {
    const identity = stableItemIdentity(item);
    if (identity === null) return true;
    return (
      stableItemIdentity(local[index]) === identity &&
      stableItemIdentity(external[index]) === identity
    );
  });
}

function stableItemIdentity(value: unknown) {
  if (!isJsonRecord(value)) return null;
  for (const key of ["id", "shapeId", "relationshipId", "name"]) {
    const candidate = value[key];
    if (typeof candidate === "string" || typeof candidate === "number") {
      return `${key}:${candidate}`;
    }
  }
  return null;
}

function stableItemLabel(value: unknown, index: number) {
  return stableItemIdentity(value) ?? String(index);
}

function changedModelPaths(base: unknown, value: unknown) {
  const paths: string[] = [];
  collectChangedPaths(base, value, "$", paths);
  return uniquePaths(paths).slice(0, 100);
}

function collectChangedPaths(
  base: MergeValue,
  value: MergeValue,
  path: string,
  paths: string[],
) {
  if (equalJson(base, value)) return;
  if (isJsonRecord(base) && isJsonRecord(value)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(value)]);
    for (const key of [...keys].sort()) {
      collectChangedPaths(
        key in base ? base[key] : MISSING,
        key in value ? value[key] : MISSING,
        `${path}.${escapePathSegment(key)}`,
        paths,
      );
    }
    return;
  }
  if (Array.isArray(base) && Array.isArray(value) && base.length === value.length) {
    base.forEach((item, index) =>
      collectChangedPaths(
        item,
        value[index],
        `${path}[${stableItemLabel(item, index)}]`,
        paths,
      ),
    );
    return;
  }
  paths.push(path);
}

function equalJson(left: MergeValue, right: MergeValue): boolean {
  if (left === MISSING || right === MISSING) return left === right;
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => equalJson(item, right[index]))
    );
  }
  if (isJsonRecord(left) && isJsonRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] && equalJson(left[key], right[key]),
      )
    );
  }
  return false;
}

function isJsonRecord(value: MergeValue): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneValue(value: MergeValue): MergeValue {
  if (value === MISSING || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function escapePathSegment(value: string) {
  return value.replaceAll(".", "\\.");
}

function uniquePaths(paths: string[]) {
  return [...new Set(paths)];
}
