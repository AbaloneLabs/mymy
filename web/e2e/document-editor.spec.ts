import { expect, test, type Page } from "@playwright/test";

const pin = process.env.MYMY_E2E_PIN;
const apiBase = process.env.MYMY_E2E_API_URL ?? "/api";

test.describe("authenticated document editor persistence", () => {
  test.skip(!pin, "MYMY_E2E_PIN is required for the authenticated browser lane");

  test("preserves edits made during save, recovers a draft, and isolates a new auth session", async ({
    page,
  }) => {
    const fileName = `e2e-editor-${crypto.randomUUID()}.txt`;
    const drivePath = `/drive/${fileName}`;
    const initial = "browser release journey";
    const firstEdit = `${initial}\nA`;
    const secondEdit = `${firstEdit}\nB`;
    const recoveryEdit = `${secondEdit}\nrecovery-only`;

    await authenticate(page);
    await page.goto("/drive");
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from(initial),
    });
    await expect(page.getByRole("status")).toContainText("1 committed");

    try {
      await page.getByRole("button", { name: fileName }).click();
      await expect(page).toHaveURL(
        new RegExp(`[?&]file=${escapeRegExp(encodeURIComponent(drivePath))}(?:&|$)`),
      );
      const source = page.getByTestId("document-editor-source");
      const save = page.getByTestId("document-editor-save");
      await expect(source).toHaveValue(initial);

      let releaseSave: (() => void) | undefined;
      const saveCanContinue = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      let firstSaveObserved: (() => void) | undefined;
      const firstSaveStarted = new Promise<void>((resolve) => {
        firstSaveObserved = resolve;
      });
      let savePutCount = 0;
      await page.route("**/api/document-editor/model", async (route) => {
        if (route.request().method() !== "PUT") {
          await route.continue();
          return;
        }
        savePutCount += 1;
        if (savePutCount === 1) {
          firstSaveObserved?.();
          await saveCanContinue;
        }
        await route.continue();
      });

      await source.fill(firstEdit);
      await save.click();
      await firstSaveStarted;
      await source.fill(secondEdit);
      releaseSave?.();
      await expect.poll(() => savePutCount).toBe(2);
      await expect(save).toBeDisabled();
      await expect(page.getByText("Unsaved changes", { exact: true })).toBeHidden();
      await page.unroute("**/api/document-editor/model");
      await page.goto(`/drive?file=${encodeURIComponent(drivePath)}`);
      await expect(page.getByTestId("document-editor-source")).toHaveValue(secondEdit);

      await page.getByTestId("document-editor-source").fill(recoveryEdit);
      await page.waitForTimeout(1_000);
      await page.reload();
      await expect(page.getByRole("button", { name: "Restore draft" })).toBeVisible();
      await page.getByRole("button", { name: "Restore draft" }).click();
      await expect(page.getByTestId("document-editor-source")).toHaveValue(recoveryEdit);

      const logoutCompleted = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/api/auth/logout"),
      );
      await page.getByRole("button", { name: "Lock", exact: true }).click();
      await expect(page).toHaveURL(/\/pin(?:\?|$)/);
      await logoutCompleted;
      await authenticate(page);
      await page.goto(`/drive?file=${encodeURIComponent(drivePath)}`);
      await expect(page.getByTestId("document-editor-source")).toHaveValue(secondEdit);
      await expect(page.getByRole("button", { name: "Restore draft" })).toHaveCount(0);
    } finally {
      await removeTestFile(page, drivePath);
    }
  });

  test("keeps a local draft through a two-tab conflict and reconciles a committed lost response", async ({
    context,
    page,
  }) => {
    const fileName = `e2e-conflict-${crypto.randomUUID()}.txt`;
    const drivePath = `/drive/${fileName}`;
    const initial = "two tab baseline";
    const localDraft = `${initial}\nlocal draft`;
    const remoteRevision = `${initial}\nremote revision`;
    const committedAfterLostResponse = `${remoteRevision}\ncommitted after lost response`;

    await authenticate(page);
    await uploadTextFile(page, fileName, initial);
    try {
      await page.getByRole("button", { name: fileName }).click();
      const localSource = page.getByTestId("document-editor-source");
      await expect(localSource).toHaveValue(initial);
      await localSource.fill(localDraft);

      const secondPage = await context.newPage();
      await secondPage.goto(`/drive?file=${encodeURIComponent(drivePath)}`);
      const remoteSource = secondPage.getByTestId("document-editor-source");
      await expect(remoteSource).toHaveValue(initial);
      await remoteSource.fill(remoteRevision);
      await secondPage.getByTestId("document-editor-save").click();
      await expect(secondPage.getByText("Unsaved", { exact: true })).toBeHidden();

      await expect(
        page.getByText(/Another browser tab saved this file/),
      ).toBeVisible();
      await expect(localSource).toHaveValue(localDraft);
      await page.getByTestId("document-editor-save").click();
      await expect(page.getByText(/This file changed after the editor opened/)).toBeVisible();
      await page.getByRole("button", { name: "Reload", exact: true }).click();
      await expect(localSource).toHaveValue(remoteRevision);
      await secondPage.close();

      const idempotencyKeys: string[] = [];
      await page.route("**/api/document-editor/model", async (route) => {
        if (route.request().method() !== "PUT") {
          await route.continue();
          return;
        }
        const body = route.request().postDataJSON() as { idempotencyKey: string };
        idempotencyKeys.push(body.idempotencyKey);
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.abort("failed");
      });
      await localSource.fill(committedAfterLostResponse);
      await page.getByTestId("document-editor-save").click();
      await expect(page.getByText(/Could not save/)).toBeVisible();
      await page.unroute("**/api/document-editor/model");

      page.on("request", (request) => {
        if (
          request.method() === "PUT" &&
          request.url().endsWith("/api/document-editor/model")
        ) {
          const body = request.postDataJSON() as { idempotencyKey: string };
          idempotencyKeys.push(body.idempotencyKey);
        }
      });
      await page.getByTestId("document-editor-save").click();
      await expect(page.getByText(/Could not save/)).toBeHidden();
      await expect.poll(() => idempotencyKeys.length).toBe(2);
      expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
      await page.goto(`/drive?file=${encodeURIComponent(drivePath)}`);
      await expect(page.getByTestId("document-editor-source")).toHaveValue(
        committedAfterLostResponse,
      );
    } finally {
      await removeTestFile(page, drivePath);
    }
  });
});

async function uploadTextFile(page: Page, fileName: string, content: string) {
  await page.goto("/drive");
  await page.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: "text/plain",
    buffer: Buffer.from(content),
  });
  await expect(page.getByRole("status")).toContainText("1 committed");
}

async function authenticate(page: Page) {
  await page.goto("/pin");
  const input = page.getByPlaceholder("PIN");
  if (/\/pin(?:\?|$)/.test(page.url())) {
    await expect(input).toBeVisible();
    await input.fill(pin ?? "");
    await page.getByRole("button", { name: "Unlock" }).click();
  }
  await expect(page).not.toHaveURL(/\/pin(?:\?|$)/);
}

async function removeTestFile(page: Page, drivePath: string) {
  await page.request.delete(apiUrl(`/drive?path=${encodeURIComponent(drivePath)}`), {
    headers: apiHeaders(page),
  });
  const trash = await page.request.get(apiUrl("/drive/trash?limit=100"), {
    headers: apiHeaders(page),
  });
  if (!trash.ok()) return;
  const body = (await trash.json()) as {
    entries: Array<{ id: string; originalPath: string; lifecycleRevision?: string }>;
  };
  const entry = body.entries.find((candidate) => candidate.originalPath === drivePath);
  if (!entry) return;
  const query = new URLSearchParams({ idempotencyKey: crypto.randomUUID() });
  if (entry.lifecycleRevision) {
    query.set("expectedLifecycleRevision", entry.lifecycleRevision);
  }
  await page.request.delete(apiUrl(`/drive/trash/${entry.id}?${query.toString()}`), {
    headers: apiHeaders(page),
  });
}

function apiHeaders(page: Page) {
  return { Origin: new URL(page.url()).origin };
}

function apiUrl(path: string) {
  return `${apiBase.replace(/\/$/, "")}${path}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
