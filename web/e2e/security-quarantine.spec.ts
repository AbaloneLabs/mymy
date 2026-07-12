import { expect, test, type Page } from "@playwright/test";

const pin = process.env.MYMY_E2E_PIN;
const apiBase = process.env.MYMY_E2E_API_URL ?? "/api";

test.describe("native suspicious-file review", () => {
  test.skip(!pin, "MYMY_E2E_PIN is required for the authenticated browser lane");

  test("keeps detected bytes unavailable until the user approves or deletes them", async ({
    page,
  }) => {
    await authenticate(page);
    const approvedName = `e2e-approve-${crypto.randomUUID()}.bin`;
    const deletedName = `e2e-delete-${crypto.randomUUID()}.bin`;
    const approvedPath = `/drive/${approvedName}`;

    await page.goto("/drive");
    await page.locator('input[type="file"]').setInputFiles([
      suspiciousFile(approvedName),
      suspiciousFile(deletedName),
    ]);
    await expect(page.getByRole("status")).toContainText(
      "0 committed, 2 awaiting review",
    );

    try {
      await page.goto("/settings?tab=security");
      const approvedCard = page.locator("article").filter({ hasText: approvedName });
      const deletedCard = page.locator("article").filter({ hasText: deletedName });
      await expect(approvedCard).toContainText("Executable content was detected.");
      await expect(deletedCard).toContainText("Executable content was detected.");

      await deletedCard.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(deletedCard).toBeHidden();
      const deniedBeforeApproval = await page.request.get(
        apiUrl(`/drive/file?path=${encodeURIComponent(approvedPath)}`),
      );
      expect(deniedBeforeApproval.status()).toBe(423);

      await approvedCard.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(approvedCard).toBeHidden();
      const availableAfterApproval = await page.request.get(
        apiUrl(`/drive/file?path=${encodeURIComponent(approvedPath)}`),
      );
      expect(availableAfterApproval.ok()).toBe(true);
    } finally {
      await purgeDrivePath(page, approvedPath);
      await deletePendingByName(page, approvedName);
      await deletePendingByName(page, deletedName);
    }
  });
});

function suspiciousFile(name: string) {
  return {
    name,
    mimeType: "application/octet-stream",
    buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x62, 0x6f, 0x75, 0x6e, 0x64, 0x65, 0x64]),
  };
}

async function authenticate(page: Page) {
  await page.goto("/pin");
  if (/\/pin(?:\?|$)/.test(page.url())) {
    await page.getByPlaceholder("PIN").fill(pin ?? "");
    await page.getByRole("button", { name: "Unlock" }).click();
  }
  await expect(page).not.toHaveURL(/\/pin(?:\?|$)/);
}

async function purgeDrivePath(page: Page, path: string) {
  const headers = apiHeaders(page);
  await page.request.delete(apiUrl(`/drive?path=${encodeURIComponent(path)}`), {
    headers,
  });
  const trash = await page.request.get(apiUrl("/drive/trash?limit=100"));
  if (!trash.ok()) return;
  const body = (await trash.json()) as {
    entries: Array<{ id: string; originalPath: string; lifecycleRevision?: string }>;
  };
  const entry = body.entries.find((candidate) => candidate.originalPath === path);
  if (!entry) return;
  const query = new URLSearchParams({ idempotencyKey: crypto.randomUUID() });
  if (entry.lifecycleRevision) {
    query.set("expectedLifecycleRevision", entry.lifecycleRevision);
  }
  await page.request.delete(apiUrl(`/drive/trash/${entry.id}?${query.toString()}`), {
    headers,
  });
}

async function deletePendingByName(page: Page, name: string) {
  const response = await page.request.get(
    apiUrl("/settings/security/quarantine?status=pending&limit=100"),
  );
  if (!response.ok()) return;
  const body = (await response.json()) as {
    items: Array<{ id: string; normalizedName: string; version: number }>;
  };
  const item = body.items.find((candidate) => candidate.normalizedName === name);
  if (!item) return;
  await page.request.delete(apiUrl(`/settings/security/quarantine/${item.id}`), {
    headers: apiHeaders(page),
    data: { expectedVersion: item.version },
  });
}

function apiUrl(path: string) {
  return `${apiBase.replace(/\/$/, "")}${path}`;
}

function apiHeaders(page: Page) {
  return { Origin: new URL(page.url()).origin };
}
