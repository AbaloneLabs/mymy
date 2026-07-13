import { describe, expect, it } from "vitest";
import {
  deploymentEntryChanged,
  entryModuleSource,
  isDynamicImportFailure,
  routeRecoveryAllowed,
} from "./deploymentVersion";

describe("deployment version detection", () => {
  it("reads a Vite entry regardless of script attribute order", () => {
    expect(
      entryModuleSource(
        '<script crossorigin src="/assets/index-new.js" type="module"></script>',
      ),
    ).toBe("/assets/index-new.js");
  });

  it("distinguishes a replacement entry from the running build", () => {
    const html = '<script type="module" src="/assets/index-next.js"></script>';
    expect(deploymentEntryChanged("/assets/index-old.js", html)).toBe(true);
    expect(deploymentEntryChanged("/assets/index-next.js", html)).toBe(false);
  });

  it("recognizes browser dynamic import failures without matching app errors", () => {
    expect(
      isDynamicImportFailure(
        new Error("Failed to fetch dynamically imported module: /assets/Chat-old.js"),
      ),
    ).toBe(true);
    expect(isDynamicImportFailure(new Error("render failed"))).toBe(false);
  });

  it("allows only one automatic recovery per route window", () => {
    const now = 1_000_000;
    const stored = JSON.stringify({ href: "/chat", attemptedAt: now - 1_000 });
    expect(routeRecoveryAllowed(stored, "/chat", now)).toBe(false);
    expect(routeRecoveryAllowed(stored, "/settings", now)).toBe(true);
    expect(routeRecoveryAllowed(stored, "/chat", now + 5 * 60_000)).toBe(true);
  });
});
