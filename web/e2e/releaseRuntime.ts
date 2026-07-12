import { readFileSync } from "node:fs";
import { join } from "node:path";

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
      readFileSync(join(process.cwd(), ".e2e-runtime.json"), "utf8"),
    ) as ReleaseRuntime;
    if (runtime.apiBase && !runtime.apiBase.startsWith("/")) return runtime.apiBase;
  } catch (error) {
    if (process.env.CI) {
      throw new Error("release runtime API configuration is unavailable", {
        cause: error,
      });
    }
    // Ordinary local runs do not need a runtime file when their environment
    // already contains an absolute API URL.
  }

  const port = process.env.API_PORT;
  return port ? `http://127.0.0.1:${port}/api` : (configured ?? "/api");
}
