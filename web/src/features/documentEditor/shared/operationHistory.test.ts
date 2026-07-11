import { describe, expect, it } from "vitest";
import {
  applyEditorOperations,
  coalesceEditorOperationEntries,
  createEditorOperationEntry,
  type EditorOperationEntry,
} from "./operationHistory";

describe("document editor operation history", () => {
  it("records forward and inverse operations that round-trip JSON models", () => {
    const before = {
      blocks: [{ id: "p1", text: "Alpha" }],
      page: { orientation: "portrait" },
    };
    const after = {
      blocks: [
        { id: "p1", text: "Beta" },
        { id: "p2", text: "Gamma" },
      ],
      page: { orientation: "landscape" },
    };

    const entry = createEditorOperationEntry({ before, after, label: "Edit blocks" });

    expect(entry).not.toBeNull();
    expect(applyEditorOperations(before, entry?.forward ?? [])).toEqual(after);
    expect(applyEditorOperations(after, entry?.inverse ?? [])).toEqual(before);
    expect(entry?.label).toBe("Edit blocks");
  });

  it("does not create an operation when the stable model is unchanged", () => {
    const model = { blocks: [{ id: "p1", text: "Alpha" }] };

    expect(createEditorOperationEntry({ before: model, after: { ...model } })).toBeNull();
  });

  it("stores changed paths instead of complete serialized model snapshots", () => {
    const unchangedRows = Array.from({ length: 200 }, (_, index) => ({
      id: `r${index}`,
      cells: ["unchanged".repeat(20)],
    }));
    const before = { rows: unchangedRows, active: { value: "before" } };
    const after = { ...before, active: { value: "after" } };

    const entry = createEditorOperationEntry({ before, after });

    expect(entry?.forward).toEqual([
      {
        kind: "text",
        path: ["active", "value"],
        start: 0,
        before: "before",
        after: "after",
      },
    ]);
    expect(entry?.size ?? Number.POSITIVE_INFINITY).toBeLessThan(1_000);
  });

  it("stores a bounded text splice for a large source edit", () => {
    const prefix = "unchanged\n".repeat(100_000);
    const before = { content: `${prefix}before\ntail` };
    const after = { content: `${prefix}after\ntail` };

    const entry = createEditorOperationEntry({ before, after });

    expect(entry?.forward).toEqual([
      {
        kind: "text",
        path: ["content"],
        start: prefix.length,
        before: "before",
        after: "after",
      },
    ]);
    expect(entry?.size ?? Number.POSITIVE_INFINITY).toBeLessThan(500);
    expect(applyEditorOperations(before, entry?.forward ?? [])).toEqual(after);
    expect(applyEditorOperations(after, entry?.inverse ?? [])).toEqual(before);
  });

  it("groups consecutive typing and backspace into bounded undo entries", () => {
    const base = { content: "" };
    const first = createEditorOperationEntry({ before: base, after: { content: "a" } })!;
    first.beforeRevisionKey = "server:r1";
    first.afterRevisionKey = "local:1";
    const second = createEditorOperationEntry({
      before: { content: "a" },
      after: { content: "ab" },
    })!;
    second.beforeRevisionKey = "local:1";
    second.afterRevisionKey = "local:2";
    second.timestamp = first.timestamp + 10;
    const typed = coalesceEditorOperationEntries(first, second);
    expect(typed?.forward).toEqual([
      {
        kind: "text",
        path: ["content"],
        start: 0,
        before: "",
        after: "ab",
      },
    ]);
    expect(typed).toMatchObject({
      beforeRevisionKey: "server:r1",
      afterRevisionKey: "local:2",
    });

    const eraseB = createEditorOperationEntry({
      before: { content: "ab" },
      after: { content: "a" },
    })!;
    eraseB.timestamp = (typed?.timestamp ?? 0) + 10;
    const eraseA = createEditorOperationEntry({
      before: { content: "a" },
      after: { content: "" },
    })!;
    eraseA.timestamp = eraseB.timestamp + 10;
    const erased = coalesceEditorOperationEntries(eraseB, eraseA);
    expect(erased?.forward[0]).toMatchObject({ before: "ab", after: "" });
  });

  it("keeps one hundred long-session operations bounded and reversible", () => {
    const base = {
      rows: Array.from({ length: 2_000 }, (_, index) => ({
        id: `row-${index}`,
        cells: [{ ref: `A${index + 1}`, value: "unchanged" }],
      })),
    };
    const selectedRowId = "row-1999";
    const history: EditorOperationEntry[] = [];
    let current = base;

    for (let index = 0; index < 100; index += 1) {
      const next = {
        ...current,
        rows: current.rows.map((row, rowIndex) =>
          rowIndex === index
            ? { ...row, cells: [{ ...row.cells[0], value: `edit-${index}` }] }
            : row,
        ),
      };
      const entry = createEditorOperationEntry({
        before: current,
        beforeKey: `revision-${index}`,
        after: next,
        afterKey: `revision-${index + 1}`,
      });
      expect(entry).not.toBeNull();
      expect(applyEditorOperations(current, entry?.forward ?? [])).toEqual(next);
      history.push(entry!);
      current = next;
    }

    expect(history.reduce((total, entry) => total + entry.size, 0)).toBeLessThan(
      100_000,
    );
    expect(current.rows.some((row) => row.id === selectedRowId)).toBe(true);
    for (const entry of history.toReversed()) {
      current = applyEditorOperations(current, entry.inverse) as typeof current;
    }
    expect(current).toEqual(base);
    expect(history.at(-1)).toMatchObject({
      beforeRevisionKey: "revision-99",
      afterRevisionKey: "revision-100",
    });
  });
});
