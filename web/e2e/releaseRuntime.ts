import type { TestInfo } from "@playwright/test";

/**
 * Resolve the ephemeral endpoints from Playwright's serialized configuration
 * instead of worker environment variables. The values contain no credential;
 * PIN and harness authentication remain separate process-only inputs.
 */
export function releaseRuntime(testInfo: TestInfo) {
  const apiBase = (testInfo.config.metadata as Record<string, unknown>)
    .releaseApiURL;
  const webBase = testInfo.project.use.baseURL;
  if (
    typeof apiBase !== "string" ||
    apiBase.startsWith("/") ||
    typeof webBase !== "string" ||
    !webBase.startsWith("http")
  ) {
    throw new Error("absolute release API and web URLs are required");
  }
  return { apiBase, webBase };
}
