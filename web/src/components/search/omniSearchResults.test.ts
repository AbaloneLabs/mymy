import { describe, expect, it } from "vitest";
import type { WorkspaceSearchHit } from "@/types/search";
import {
  workspaceSearchHitKey,
  workspaceSearchHitRoute,
} from "./omniSearchResults";

function hit(overrides: Partial<WorkspaceSearchHit>): WorkspaceSearchHit {
  return {
    domain: "notes",
    resourceKind: "note",
    stableId: "00000000-0000-0000-0000-000000000001",
    title: "Generated test title",
    scope: "project_or_global",
    lifecycleState: "active",
    evidenceRole: "unknown",
    sourceLink: { kind: "note", id: "00000000-0000-0000-0000-000000000001" },
    normalizedScore: 1,
    reasonCodes: ["exact_title"],
    ...overrides,
  };
}

describe("workspaceSearchHitRoute", () => {
  it("builds registered internal routes for normalized adapter links", () => {
    expect(workspaceSearchHitRoute(hit({}))).toBe(
      "/notes?noteId=00000000-0000-0000-0000-000000000001",
    );
    expect(
      workspaceSearchHitRoute(
        hit({
          domain: "drive",
          resourceKind: "drive_file",
          sourceLink: { kind: "drive", path: "/drive/shared/report A.md" },
        }),
      ),
    ).toBe("/drive?file=%2Fdrive%2Fshared%2Freport%20A.md");
    expect(
      workspaceSearchHitRoute(
        hit({
          domain: "calendar",
          resourceKind: "calendar_event",
          freshness: "2026-07-12T10:00:00Z",
          sourceLink: { kind: "calendar_event", id: "event-id" },
        }),
      ),
    ).toBe("/calendar?eventId=event-id&date=2026-07-12T10%3A00%3A00Z");
  });

  it("does not navigate an unregistered Drive path", () => {
    expect(
      workspaceSearchHitRoute(
        hit({
          domain: "drive",
          resourceKind: "drive_file",
          sourceLink: { kind: "drive", path: "https://example.invalid/escape" },
        }),
      ),
    ).toBe("/drive");
  });

  it("keeps independently typed resources distinct", () => {
    const first = hit({ domain: "notes", resourceKind: "note" });
    const second = hit({ domain: "tasks", resourceKind: "task" });
    expect(workspaceSearchHitKey(first)).not.toBe(workspaceSearchHitKey(second));
  });
});
