import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.MYMY_E2E_BASE_URL ?? "http://127.0.0.1:33696";
const apiURL = process.env.MYMY_E2E_API_URL ?? "/api";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // Mandatory release journeys fail on their first nondeterministic result;
  // retrying until green would hide a race and produce false evidence.
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  // Playwright serializes metadata into every worker. The local GitLab runner
  // does not preserve dynamic URL environment variables in workers, so this
  // is the authoritative non-secret transport for the ephemeral API address.
  metadata: { releaseApiURL: apiURL },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Playwright disables BFCache by default for test isolation. The
        // release lane deliberately exercises real history restoration, so
        // this one browser default must match production Chromium.
        launchOptions: {
          channel: "chromium",
          ignoreDefaultArgs: ["--disable-back-forward-cache"],
        },
      },
    },
  ],
});
