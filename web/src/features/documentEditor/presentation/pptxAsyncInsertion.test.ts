import { describe, expect, test, vi } from "vitest";
import type { PptxModel } from "../shared/models";
import { createPptxAsyncInsertionCoordinator } from "./pptxAsyncInsertion";

describe("PPTX asynchronous insertion coordinator", () => {
  test("rebases consecutive completions onto the latest accepted model", () => {
    const initial: PptxModel = {
      slides: [{ id: "a", name: "a", texts: [{ id: "t1", text: "A" }] }],
    };
    const commits: PptxModel[] = [];
    const coordinator = createPptxAsyncInsertionCoordinator({
      initialModel: initial,
      onCommit: (model) => commits.push(model),
      onPendingChange: vi.fn(),
      onResult: vi.fn(),
    });
    const externallyEdited: PptxModel = {
      ...initial,
      slides: [
        { ...initial.slides[0], texts: [{ id: "t1", text: "A then B" }] },
      ],
    };
    coordinator.sync(externallyEdited, (model) => commits.push(model));
    coordinator.applyLatest((model) => ({ ...model, slideSizeType: "first" }));
    coordinator.applyLatest((model) => ({ ...model, slideSizeType: `${model.slideSizeType}+second` }));

    expect(commits).toHaveLength(2);
    expect(commits[1].slides[0].texts[0].text).toBe("A then B");
    expect(commits[1].slideSizeType).toBe("first+second");
  });

  test("cancels every unfinished operation without mutating the model", () => {
    const cancelA = vi.fn();
    const cancelB = vi.fn();
    const pending = vi.fn();
    const coordinator = createPptxAsyncInsertionCoordinator({
      initialModel: { slides: [] },
      onCommit: vi.fn(),
      onPendingChange: pending,
      onResult: vi.fn(),
    });
    coordinator.register("A", cancelA);
    coordinator.register("B", cancelB);
    coordinator.cancelAll();

    expect(cancelA).toHaveBeenCalledOnce();
    expect(cancelB).toHaveBeenCalledOnce();
    expect(pending).toHaveBeenLastCalledWith([]);
  });
});
