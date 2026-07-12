import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const pin = process.env.MYMY_E2E_PIN;
const apiBase = process.env.MYMY_E2E_API_URL ?? "/api";
const webBase = process.env.MYMY_E2E_BASE_URL ?? "http://127.0.0.1:33696";

interface DeliveryBudget {
  revision: string;
  maximumInitialParseExecuteMs: number;
  requiredLazyRecoveryRoute: string;
}

test.describe("frontend delivery certification", () => {
  test.skip(
    !pin || apiBase.startsWith("/"),
    "MYMY_E2E_PIN and an absolute MYMY_E2E_API_URL are required",
  );

  test("keeps parse/execute bounded and recovers one failed lazy route", async ({
    browser,
    context,
    page,
  }) => {
    const budget = JSON.parse(
      readFileSync(new URL("../performance-budgets.json", import.meta.url), "utf8"),
    ) as DeliveryBudget;
    const authenticated = await context.request.post(apiUrl("/auth/verify"), {
      headers: { Origin: new URL(webBase).origin },
      data: { pin },
    });
    expect(authenticated.ok(), await authenticated.text()).toBe(true);

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
    const initialParseExecuteMs = await page.evaluate(() => {
      const navigation = performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming;
      return navigation.domContentLoadedEventEnd - navigation.responseEnd;
    });
    expect(initialParseExecuteMs).toBeLessThanOrEqual(
      budget.maximumInitialParseExecuteMs,
    );

    let rejectedOnce = false;
    await page.route("**/assets/DecisionsPage-*.js", async (route) => {
      if (!rejectedOnce) {
        rejectedOnce = true;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Decisions", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "This page could not be loaded.",
    );
    await page.getByRole("button", { name: "Retry loading page" }).click();
    await expect(
      page.getByRole("heading", { name: "Decisions", exact: true, level: 1 }),
    ).toBeVisible();
    expect(rejectedOnce).toBe(true);

    const directory = process.env.MYMY_RELEASE_EVIDENCE_DIR;
    if (directory) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, "loc06-delivery-runtime.json"),
        `${JSON.stringify(
          {
            testId: "LOC-06-runtime-delivery-budget",
            state: "passed",
            revision: budget.revision,
            candidateCommit: process.env.CI_COMMIT_SHA ?? "working-tree",
            browserVersion: browser.version(),
            initialParseExecuteMs,
            maximumInitialParseExecuteMs: budget.maximumInitialParseExecuteMs,
            lazyRecoveryRoute: budget.requiredLazyRecoveryRoute,
            lazyRecoveryState: "passed",
          },
          null,
          2,
        )}\n`,
      );
    }
  });
});

function apiUrl(path: string) {
  return `${apiBase.replace(/\/$/, "")}${path}`;
}
