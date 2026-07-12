import { expect, test, type Page } from "@playwright/test";

const pin = process.env.MYMY_E2E_PIN;

test.describe("top-level workspace navigation", () => {
  test.skip(!pin, "MYMY_E2E_PIN is required for the authenticated browser lane");

  test("keeps Decisions canonical and exposes fixed Trash and Security destinations", async ({
    page,
  }) => {
    await authenticate(page);
    await page.goto("/");

    const home = page.getByRole("button", { name: "Home", exact: true });
    const decisions = page.getByRole("button", { name: "Decisions", exact: true });
    const chat = page.getByRole("button", { name: "Chat", exact: true });
    await expect(home).toBeVisible();
    await expect(decisions).toBeVisible();
    await expect(chat).toBeVisible();
    const [homeBox, decisionBox, chatBox] = await Promise.all([
      home.boundingBox(),
      decisions.boundingBox(),
      chat.boundingBox(),
    ]);
    expect(homeBox?.y).toBeLessThan(decisionBox?.y ?? 0);
    expect(decisionBox?.y).toBeLessThan(chatBox?.y ?? 0);

    await decisions.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/decisions(?:\?|$)/);
    await expect(
      page.getByRole("heading", { name: "Decisions", exact: true, level: 1 }),
    ).toBeVisible();

    await page.goto("/drive");
    const trash = page.getByRole("button", { name: /^Trash/ });
    await expect(trash).toBeVisible();
    await trash.click();
    await expect(page).toHaveURL(/[?&]view=trash(?:&|$)/);
    await expect(trash).toHaveAttribute("aria-current", "page");

    await page.goto("/settings?tab=security");
    await expect(page.getByRole("heading", { name: "Security" }).first()).toBeVisible();
    await expect(page.getByText("Suspicious file review", { exact: true })).toBeVisible();
  });

  test("preserves Decision deep-link state through mobile navigation and browser history", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await authenticate(page);
    await page.goto("/decisions?status=resolved&kind=input&blocking=false");

    await expect(page.getByLabel("Status")).toHaveValue("resolved");
    await expect(page.getByLabel("Kind")).toHaveValue("input");
    await expect(page.getByLabel("Run impact")).toHaveValue("false");
    const mobileDecisions = page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("button", { name: /^Decisions/ });
    await expect(mobileDecisions).toBeVisible();
    await expect(mobileDecisions).toHaveAttribute("aria-current", "page");

    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await expect(page).toHaveURL(/\/chat(?:\?|$)/);
    await page.goBack();
    await expect(page).toHaveURL(/\/decisions\?/);
    const restoredParams = new URL(page.url()).searchParams;
    expect(restoredParams.get("status")).toBe("resolved");
    expect(restoredParams.get("kind")).toBe("input");
    expect(restoredParams.get("blocking")).toBe("false");
    expect(restoredParams.get("scope")).toBe("all");
    await expect(page.getByLabel("Status")).toHaveValue("resolved");

    await page.goto("/agents?tab=decisions&decisionId=unavailable-decision");
    await expect(page).toHaveURL(
      /\/decisions\?decisionId=unavailable-decision&scope=all$/,
    );
    await expect(
      page.getByText(
        "The focused Decision is unavailable or you do not have access.",
        { exact: true },
      ),
    ).toBeVisible();
  });
});

async function authenticate(page: Page) {
  await page.goto("/pin");
  const input = page.getByPlaceholder("PIN");
  if (/\/pin(?:\?|$)/.test(page.url())) {
    await input.fill(pin ?? "");
    await page.getByRole("button", { name: "Unlock" }).click();
  }
  await expect(page).not.toHaveURL(/\/pin(?:\?|$)/);
}
