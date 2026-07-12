import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, request, test } from "@playwright/test";
import { releaseRuntime } from "./releaseRuntime";

const pin = process.env.MYMY_E2E_PIN;

interface DeliveryBudget {
  revision: string;
  maximumInitialParseExecuteMs: number;
  requiredLazyRecoveryRoute: string;
}

test.describe("frontend delivery certification", () => {
  test.skip(
    !pin,
    "MYMY_E2E_PIN is required",
  );

  test("keeps parse/execute bounded and recovers one failed lazy route", async ({
    browser,
    context,
    page,
  }, testInfo) => {
    const { apiBase, webBase } = releaseRuntime(testInfo);
    const budget = JSON.parse(
      readFileSync(new URL("../performance-budgets.json", import.meta.url), "utf8"),
    ) as DeliveryBudget;
    const authRequest = await request.newContext({
      baseURL: normalizedApiBase(apiBase),
      extraHTTPHeaders: { Origin: new URL(webBase).origin },
    });
    const authenticated = await authRequest.post("auth/verify", {
      data: { pin },
    });
    expect(authenticated.ok(), await authenticated.text()).toBe(true);
    const storage = await authRequest.storageState();
    await context.addCookies(storage.cookies);
    await authRequest.dispose();

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

function normalizedApiBase(apiBase: string) {
  return `${apiBase.replace(/\/$/, "")}/`;
}
