import { expect, test, type Page } from "@playwright/test";

const pin = process.env.MYMY_E2E_PIN;
const apiBase = process.env.MYMY_E2E_API_URL ?? "/api";

test.describe("authenticated federated workspace search", () => {
  test.skip(!pin, "MYMY_E2E_PIN is required for the authenticated browser lane");

  test("discovers a real resource through the shared adapter and opens its typed link", async ({
    page,
  }) => {
    await authenticate(page);
    const marker = `browser-search-${crypto.randomUUID()}`;
    const created = await page.request.post(apiUrl("/notes"), {
      headers: apiHeaders(page),
      data: {
        title: marker,
        content: "Authenticated federated browser evidence",
        projectId: null,
      },
    });
    expect(created.ok()).toBe(true);
    const note = (await created.json()) as { note: { id: string } };

    try {
      await page.goto("/");
      const search = page.getByPlaceholder("Search workspace...");
      await expect(search).toBeVisible();
      await search.fill(marker);
      const result = page.getByRole("option", { name: new RegExp(marker) });
      await expect(result).toBeVisible();
      await result.click();
      await expect(page).toHaveURL(/\/notes\?noteId=/);
      expect(new URL(page.url()).searchParams.get("noteId")).toBe(note.note.id);
      await expect(page.getByPlaceholder("Title")).toHaveValue(marker);
    } finally {
      await page.request.delete(apiUrl(`/notes/${note.note.id}`), {
        headers: apiHeaders(page),
      });
    }
  });
});

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

function apiUrl(path: string) {
  return `${apiBase.replace(/\/$/, "")}${path}`;
}

function apiHeaders(page: Page) {
  return { Origin: new URL(page.url()).origin };
}
