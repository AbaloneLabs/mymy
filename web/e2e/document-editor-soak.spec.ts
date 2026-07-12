import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { arch, cpus, platform, release, totalmem } from "node:os";

const pin = process.env.MYMY_E2E_PIN;
const minutes = Number(process.env.MYMY_EDITOR_SOAK_MINUTES ?? "0");
const apiBase = process.env.MYMY_E2E_API_URL ?? "/api";

test.describe("document editor release soak", () => {
  test.skip(
    !pin || !Number.isFinite(minutes) || minutes <= 0,
    "MYMY_E2E_PIN and MYMY_EDITOR_SOAK_MINUTES enable the release-only soak",
  );

  test("keeps save acknowledgement and browser resources bounded", async ({
    browser,
    context,
    page,
  }, testInfo) => {
    test.setTimeout((minutes + 5) * 60_000);
    const fileName = `e2e-editor-soak-${crypto.randomUUID()}.txt`;
    const drivePath = `/drive/${fileName}`;
    const initial = "release soak baseline";
    const deadline = Date.now() + minutes * 60_000;
    const samples: ResourceSample[] = [];
    const saveLatenciesMs: number[] = [];
    const reloadLatenciesMs: number[] = [];
    let iteration = 0;

    await authenticate(page);
    await page.goto("/drive");
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from(initial),
    });
    await expect(page.getByRole("status")).toContainText("1 committed");

    const client = await context.newCDPSession(page);
    await client.send("Performance.enable");

    try {
      const openStarted = performance.now();
      await page.getByRole("button", { name: fileName }).click();
      const source = page.getByTestId("document-editor-source");
      const save = page.getByTestId("document-editor-save");
      const lifecycle = page.locator('[role="status"][aria-live="polite"]');
      await expect(source).toHaveValue(initial);
      const openLatencyMs = performance.now() - openStarted;
      expect(openLatencyMs).toBeLessThanOrEqual(5_000);
      samples.push(await resourceSample(client, iteration));

      while (Date.now() < deadline) {
        iteration += 1;
        const value = `${initial}\niteration ${iteration}\n한국어 입력 ${iteration}`;
        await source.fill(value);
        const saveStarted = performance.now();
        await save.click();
        await expect(lifecycle).toHaveText(/^Saved(?:\s|$)/);
        saveLatenciesMs.push(performance.now() - saveStarted);
        await expect(save).toBeDisabled();
        await expect(page.getByText("Unsaved changes", { exact: true })).toBeHidden();

        if (iteration % 10 === 0) {
          samples.push(await resourceSample(client, iteration));
          const reloadStarted = performance.now();
          await page.reload();
          await expect(page.getByTestId("document-editor-source")).toHaveValue(value);
          reloadLatenciesMs.push(performance.now() - reloadStarted);
        }
        await page.waitForTimeout(1_000);
      }

      samples.push(await resourceSample(client, iteration));
      assertResourcePlateau(samples);
      const saveP95Ms = percentile(saveLatenciesMs, 0.95);
      const reloadP95Ms = percentile(reloadLatenciesMs, 0.95);
      expect(saveP95Ms).toBeLessThanOrEqual(2_000);
      expect(reloadP95Ms).toBeLessThanOrEqual(3_000);
      await testInfo.attach("editor-soak-metrics.json", {
        body: Buffer.from(
          JSON.stringify(
            {
              schemaVersion: 1,
              durationMinutes: minutes,
              iterations: iteration,
              browser: {
                project: testInfo.project.name,
                version: browser.version(),
              },
              host: {
                platform: platform(),
                release: release(),
                architecture: arch(),
                logicalCpuCount: cpus().length,
                cpuModel: cpus()[0]?.model ?? "unknown",
                totalMemoryBytes: totalmem(),
              },
              candidateRevision: process.env.CI_COMMIT_SHA ?? "working-tree",
              fixtureRevision: "document-editor-soak-v1",
              latencyMs: {
                open: openLatencyMs,
                saveP50: percentile(saveLatenciesMs, 0.5),
                saveP95: saveP95Ms,
                reloadP50: percentile(reloadLatenciesMs, 0.5),
                reloadP95: reloadP95Ms,
              },
              samples,
            },
            null,
            2,
          ),
        ),
        contentType: "application/json",
      });
    } finally {
      await removeTestFile(page, drivePath);
    }
  });
});

type ResourceSample = {
  elapsedIteration: number;
  jsHeapUsedBytes: number;
  nodes: number;
  documents: number;
  listeners: number;
};

async function resourceSample(
  client: CDPSession,
  elapsedIteration: number,
): Promise<ResourceSample> {
  // Release measurements compare live retained state, not detached DOM waiting
  // for a nondeterministic browser GC after route reloads.
  await client.send("HeapProfiler.collectGarbage");
  const [performance, dom] = await Promise.all([
    client.send("Performance.getMetrics"),
    client.send("Memory.getDOMCounters"),
  ]);
  const metrics = new Map(performance.metrics.map((metric) => [metric.name, metric.value]));
  return {
    elapsedIteration,
    jsHeapUsedBytes: metrics.get("JSHeapUsedSize") ?? 0,
    nodes: dom.nodes,
    documents: dom.documents,
    listeners: dom.jsEventListeners,
  };
}

function assertResourcePlateau(samples: ResourceSample[]) {
  expect(samples.length).toBeGreaterThanOrEqual(2);
  const baseline = samples[Math.min(1, samples.length - 1)];
  const final = samples[samples.length - 1];
  expect(final.jsHeapUsedBytes).toBeLessThanOrEqual(
    Math.max(baseline.jsHeapUsedBytes * 1.5, baseline.jsHeapUsedBytes + 64 * 1024 * 1024),
  );
  expect(final.nodes).toBeLessThanOrEqual(baseline.nodes + 1_500);
  expect(final.documents).toBeLessThanOrEqual(baseline.documents + 20);
  expect(final.listeners).toBeLessThanOrEqual(baseline.listeners + 500);
}

function percentile(values: number[], quantile: number) {
  expect(values.length).toBeGreaterThan(0);
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

async function authenticate(page: Page) {
  await page.goto("/pin");
  const input = page.getByPlaceholder("PIN");
  if (/\/pin(?:\?|$)/.test(page.url())) {
    await input.fill(pin ?? "");
    await page.getByRole("button", { name: "Unlock" }).click();
  }
  await expect(page).not.toHaveURL(/\/pin(?:\?|$)/);
}

async function removeTestFile(page: Page, drivePath: string) {
  const headers = { Origin: new URL(page.url()).origin };
  await page.request.delete(apiUrl(`/drive?path=${encodeURIComponent(drivePath)}`), { headers });
  const trash = await page.request.get(apiUrl("/drive/trash?limit=100"), { headers });
  if (!trash.ok()) return;
  const body = (await trash.json()) as {
    entries: Array<{ id: string; originalPath: string; lifecycleRevision?: string }>;
  };
  const entry = body.entries.find((candidate) => candidate.originalPath === drivePath);
  if (!entry) return;
  const query = new URLSearchParams({ idempotencyKey: crypto.randomUUID() });
  if (entry.lifecycleRevision) query.set("expectedLifecycleRevision", entry.lifecycleRevision);
  await page.request.delete(apiUrl(`/drive/trash/${entry.id}?${query.toString()}`), { headers });
}

function apiUrl(path: string) {
  return `${apiBase.replace(/\/$/, "")}${path}`;
}
