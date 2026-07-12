import { readFileSync } from "node:fs";

interface ReleaseRuntime {
  apiBase: string;
}

/**
 * Resolve the ephemeral API independently of Playwright worker environment
 * inheritance. GitLab writes only the non-secret loopback URL to the ignored
 * runtime file; credentials remain in process memory and never enter it.
 */
export function releaseApiBase() {
  const configured = process.env.MYMY_E2E_API_URL;
  if (configured && !configured.startsWith("/")) return configured;

  try {
    const runtime = JSON.parse(
      readFileSync(new URL("../.e2e-runtime.json", import.meta.url), "utf8"),
    ) as ReleaseRuntime;
    if (runtime.apiBase && !runtime.apiBase.startsWith("/")) return runtime.apiBase;
  } catch {
    // Ordinary local runs do not need a runtime file when their environment
    // already contains an absolute API URL.
  }

  const port = process.env.API_PORT;
  return port ? `http://127.0.0.1:${port}/api` : (configured ?? "/api");
}
