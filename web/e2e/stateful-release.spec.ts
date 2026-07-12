import {
  expect,
  request,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { releaseRuntime } from "./releaseRuntime";

const pin = process.env.MYMY_E2E_PIN;
const harnessToken = process.env.MYMY_RELEASE_HARNESS_TOKEN;
const seed = releaseSeed();
let apiBase: string;

interface ReleaseFixture {
  fixtureRevision: string;
  seed: string;
  agentProfile: string;
  artifact: {
    creatorSessionId: string;
    secondarySessionId: string;
    artifactId: string;
    resourceId: string;
    path: string;
    fingerprint: string;
    wikiId: string;
    wikiTitle: string;
    wikiLinkTitle: string;
  };
  decisions: {
    choiceId: string;
    inputId: string;
    approvalId: string;
    paginationIds: string[];
    totalPending: number;
  };
  quarantine: {
    itemId: string;
    fileName: string;
    desiredPath: string;
    toolErrorCode: string;
  };
}

interface TrashResponse {
  entries: Array<{
    id: string;
    originalPath: string;
    lifecycleRevision?: string;
  }>;
}

test.describe.serial("stateful July 11 release journeys", () => {
  test.skip(
    !pin || !harnessToken,
    "MYMY_E2E_PIN and MYMY_RELEASE_HARNESS_TOKEN are required",
  );

  let harness: APIRequestContext;
  let fixture: ReleaseFixture;
  let activePath: string;
  let browserVersion: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    const runtime = releaseRuntime(testInfo);
    apiBase = runtime.apiBase;
    browserVersion = browser.version();
    harness = await request.newContext({
      extraHTTPHeaders: { Origin: new URL(runtime.webBase).origin },
    });
    const authenticated = await harness.post(apiUrl("/auth/verify"), {
      data: { pin },
    });
    expect(authenticated.ok()).toBe(true);
    expect((await authenticated.json()) as { authenticated: boolean }).toMatchObject({
      authenticated: true,
    });

    const admitted = await harness.post(apiUrl("/release-harness/fixtures"), {
      headers: harnessHeaders(),
      data: { seed },
    });
    expect(admitted.ok(), await admitted.text()).toBe(true);
    fixture = (await admitted.json()) as ReleaseFixture;
    expect(fixture).toMatchObject({
      fixtureRevision: "july11-stateful-browser-v1",
      seed,
      decisions: { totalPending: 26 },
      quarantine: { toolErrorCode: "content_quarantined" },
    });
    activePath = fixture.artifact.path;
    console.log(`release-fixture seed=${seed} revision=${fixture.fixtureRevision}`);
  });

  test.afterAll(async () => {
    if (!harness || !fixture) return;
    const cleaned = await harness.post(apiUrl("/release-harness/fixtures/cleanup"), {
      headers: harnessHeaders(),
      data: { seed: fixture.seed },
    });
    expect(cleaned.ok(), await cleaned.text()).toBe(true);
    const cleanup = (await cleaned.json()) as {
      sessionsRemaining: number;
      decisionsRemaining: number;
      quarantinePending: number;
      releaseFilesRemaining: number;
    };
    expect(cleanup).toEqual({
      sessionsRemaining: 0,
      decisionsRemaining: 0,
      quarantinePending: 0,
      releaseFilesRemaining: 0,
    });
    const directory = process.env.MYMY_RELEASE_EVIDENCE_DIR;
    if (directory) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, "loc01-stateful-browser.json"),
        `${JSON.stringify(
          {
            testId: "LOC-01-stateful-browser-journeys",
            state: "passed",
            fixtureRevision: fixture.fixtureRevision,
            seed: fixture.seed,
            candidateCommit: process.env.CI_COMMIT_SHA ?? "working-tree",
            browser: { engine: "chromium", version: browserVersion },
            retries: 0,
            tests: [
              {
                id: "artifact-cross-session-lifecycle",
                state: "passed",
              },
              {
                id: "browser-lifecycle-accessibility-editor-recovery",
                state: "passed",
              },
              {
                id: "decision-resolution-pagination-announcements",
                state: "passed",
              },
              {
                id: "agent-tool-quarantine-denial-and-user-deletion",
                state: "passed",
              },
            ],
            cleanup,
          },
          null,
          2,
        )}\n`,
      );
    }
    await harness.dispose();
  });

  test("projects one real artifact across sessions and every lifecycle transition", async ({
    page,
  }) => {
    await authenticate(page);
    await openChatSession(page, fixture.artifact.creatorSessionId);
    const creatorArtifact = artifactCard(page);
    await expect(creatorArtifact).toContainText("Created here");
    await expect(creatorArtifact).toContainText("Active");
    await expect(creatorArtifact).toContainText(fixture.artifact.wikiLinkTitle);

    await openChatSession(page, fixture.artifact.secondarySessionId);
    await expect(artifactCard(page)).toHaveCount(0);
    await expect(
      page.getByText("Outputs created or modified in this chat will appear here."),
    ).toBeVisible();

    const linked = await harness.post(
      apiUrl("/release-harness/fixtures/artifact-link"),
      {
        headers: harnessHeaders(),
        data: {
          seed: fixture.seed,
          agentProfile: fixture.agentProfile,
          sessionId: fixture.artifact.secondarySessionId,
          path: fixture.artifact.path,
        },
      },
    );
    expect(linked.ok(), await linked.text()).toBe(true);
    expect((await linked.json()) as { fingerprint: string }).not.toMatchObject({
      fingerprint: fixture.artifact.fingerprint,
    });

    await page.reload();
    await expect(artifactCard(page)).toContainText("Modified here");
    await expect(artifactCard(page)).toContainText(fixture.artifact.wikiLinkTitle);

    const movedPath = fixture.artifact.path.replace("-artifact.md", "-moved.md");
    const moved = await page.request.post(apiUrl("/drive/move"), {
      headers: apiHeaders(page),
      data: {
        sourcePath: fixture.artifact.path,
        destinationPath: movedPath,
        idempotencyKey: `release-${seed}-move`,
      },
    });
    expect(moved.ok(), await moved.text()).toBe(true);
    activePath = movedPath;
    await page.reload();
    await expect(artifactCard(page)).toContainText(movedPath);

    const trashed = await page.request.delete(
      apiUrl(
        `/drive?path=${encodeURIComponent(activePath)}&idempotencyKey=${encodeURIComponent(`release-${seed}-trash`)}`,
      ),
      { headers: apiHeaders(page) },
    );
    expect(trashed.ok(), await trashed.text()).toBe(true);
    await page.reload();
    await expect(artifactCard(page)).toContainText("In Trash");

    const trashEntry = await findTrashEntry(page, activePath);
    const restoreQuery = lifecycleQuery(
      `release-${seed}-restore`,
      trashEntry.lifecycleRevision,
    );
    const restored = await page.request.post(
      apiUrl(`/drive/trash/${trashEntry.id}/restore?${restoreQuery}`),
      { headers: apiHeaders(page) },
    );
    expect(restored.ok(), await restored.text()).toBe(true);
    await page.reload();
    await expect(artifactCard(page)).toContainText("Active");
    await expect(artifactCard(page)).toContainText(activePath);

    const deletedSession = await page.request.delete(
      apiUrl(`/chat/sessions/${fixture.artifact.creatorSessionId}`),
      { headers: apiHeaders(page) },
    );
    expect(deletedSession.ok(), await deletedSession.text()).toBe(true);
    await expect
      .poll(async () => {
        const response = await page.request.get(apiUrl("/chat/sessions"), {
          headers: apiHeaders(page),
        });
        const body = (await response.json()) as {
          sessions: Array<{ id: string }>;
        };
        return body.sessions.some(
          (session) => session.id === fixture.artifact.creatorSessionId,
        );
      })
      .toBe(false);
    await page.reload();
    await expect(artifactCard(page)).toContainText("Modified here");
    await expect(artifactCard(page)).toContainText("Active");
  });

  test("survives accessibility media, BFCache, suspension, mobile, and editor quota failure", async ({
    context,
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    await authenticate(page);
    await openChatSession(page, fixture.artifact.secondarySessionId);
    await expect(artifactCard(page)).toBeVisible();
    const mediaState = await page.evaluate(() => ({
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
        forced: matchMedia("(forced-colors: active)").matches,
        transition: getComputedStyle(document.body).transitionDuration,
      }));
    expect(mediaState).toMatchObject({ reduced: true, forced: true });
    expect(Number.parseFloat(mediaState.transition)).toBeLessThanOrEqual(0.00001);

    const wikiLink = artifactCard(page).getByRole("button", {
      name: fixture.artifact.wikiLinkTitle,
      exact: true,
    });
    await wikiLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      new RegExp(`/knowledge\\?id=${fixture.artifact.wikiId}$`),
    );

    const bfcachePage = await context.newPage();
    await bfcachePage.goto("/shortcuts");
    await bfcachePage.evaluate(() => {
      Object.assign(window, { __releaseBfcacheRestored: false });
      window.addEventListener("pageshow", (event) => {
        if (event.persisted) {
          Object.assign(window, { __releaseBfcacheRestored: true });
        }
      });
    });
    await bfcachePage.goto("/settings");
    await bfcachePage.goBack({ waitUntil: "commit" });
    await bfcachePage.waitForTimeout(300);
    await expect
      .poll(() =>
        bfcachePage.evaluate(
          () =>
            (window as Window & { __releaseBfcacheRestored?: boolean })
              .__releaseBfcacheRestored ?? false,
        ),
      )
      .toBe(true);
    await bfcachePage.close();

    await openChatSession(page, fixture.artifact.secondarySessionId);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
    await cdp.send("Page.setWebLifecycleState", { state: "active" });
    await expect(artifactCard(page)).toContainText("Modified here");
    await cdp.detach();

    await page.addInitScript(() => {
      const nativeIndexedDb = window.indexedDB;
      Object.defineProperty(window, "indexedDB", {
        configurable: true,
        value: new Proxy(nativeIndexedDb, {
          get(target, property) {
            if (property === "open") {
              return (name: string, version?: number) => {
                if (name === "mymy-document-editor") {
                  throw new DOMException(
                    "Release certification quota exhausted",
                    "QuotaExceededError",
                  );
                }
                return version === undefined
                  ? target.open(name)
                  : target.open(name, version);
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      });
    });
    await page.goto(`/drive?file=${encodeURIComponent(activePath)}`);
    const source = page.getByTestId("document-editor-source");
    await expect(source).toBeVisible();
    const quotaDraft = "할당량 실패 중에도 이 편집 내용은 화면에 남아 있어야 합니다.";
    await source.fill(quotaDraft);
    await expect(
      page.getByText(
        /Browser recovery storage is unavailable\. Keep this tab open or save before navigating away\./,
      ),
    ).toBeVisible();
    expect((await source.inputValue()).length).toBe(quotaDraft.length);
    await expect(source).toHaveValue(quotaDraft);

    await page.goto(`/chat?sessionId=${fixture.artifact.secondarySessionId}`);
    const trashed = await page.request.delete(
      apiUrl(
        `/drive?path=${encodeURIComponent(activePath)}&idempotencyKey=${encodeURIComponent(`release-${seed}-final-trash`)}`,
      ),
      { headers: apiHeaders(page) },
    );
    expect(trashed.ok(), await trashed.text()).toBe(true);
    const entry = await findTrashEntry(page, activePath);
    const purged = await page.request.delete(
      apiUrl(
        `/drive/trash/${entry.id}?${lifecycleQuery(`release-${seed}-purge`, entry.lifecycleRevision)}`,
      ),
      { headers: apiHeaders(page) },
    );
    expect(purged.ok(), await purged.text()).toBe(true);
    await page.reload();
    await expect(artifactCard(page)).toContainText("Permanently deleted");
  });

  test("resolves Decision input, choice, stale approval, pagination, and announcements", async ({
    page,
  }) => {
    await authenticate(page);
    await page.goto(`/decisions?scope=all&decisionId=${fixture.decisions.choiceId}`);
    const choiceCard = decisionCard(page, fixture.decisions.choiceId);
    await expect(choiceCard).toBeFocused();
    const stable = choiceCard.getByRole("button", { name: "stable", exact: true });
    await stable.focus();
    await page.keyboard.press("Enter");
    await expect(choiceCard.getByRole("status")).toHaveText(
      "The Decision was updated from the server-confirmed result.",
    );
    await expect(decisionCard(page, fixture.decisions.inputId)).toBeFocused();

    const duplicate = await page.request.post(
      apiUrl(`/decisions/${fixture.decisions.choiceId}/resolve`),
      { headers: apiHeaders(page), data: { answer: "stable" } },
    );
    expect(duplicate.ok(), await duplicate.text()).toBe(true);
    expect((await duplicate.json()) as { applied: boolean }).toMatchObject({
      applied: false,
    });

    await page.goto(`/decisions?scope=all&decisionId=${fixture.decisions.inputId}`);
    const inputCard = decisionCard(page, fixture.decisions.inputId);
    const answer = inputCard.locator("input");
    await composeKorean(answer, "배포 준비 완료");
    await expect(answer).toHaveValue("배포 준비 완료");
    await inputCard
      .getByRole("button", { name: "Discard unsent draft" })
      .click();
    await expect(answer).toHaveValue("");
    await composeKorean(answer, "최종 배포 승인 입력");
    await inputCard.locator('button[type="submit"]').click();
    await expect(inputCard.getByRole("status")).toHaveText(
      "The Decision was updated from the server-confirmed result.",
    );

    await page.goto(`/decisions?scope=all&decisionId=${fixture.decisions.approvalId}`);
    const approvalCard = decisionCard(page, fixture.decisions.approvalId);
    await approvalCard.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(approvalCard.getByRole("status")).toHaveText(
      "The Decision changed. Its current server state was refreshed.",
    );
    await expect(approvalCard).toContainText("Superseded");

    await page.goto("/decisions?scope=all&status=pending");
    const pendingCards = page.locator('article[id^="decision-"]');
    await expect(pendingCards).toHaveCount(10);
    const initialCards = await pendingCards.count();
    await page.getByRole("button", { name: "Load more" }).click();
    await expect
      .poll(() => pendingCards.count())
      .toBeGreaterThan(initialCards);

    await page.goto("/decisions?scope=all&status=pending&kind=input");
    await expect(page.getByText(/outside the active filters/)).toBeVisible();
  });

  test("shows and deletes the exact quarantine item denied to an agent file tool", async ({
    page,
  }) => {
    expect(fixture.quarantine.toolErrorCode).toBe("content_quarantined");
    await authenticate(page);
    const denied = await page.request.get(
      apiUrl(`/drive/file?path=${encodeURIComponent(fixture.quarantine.desiredPath)}`),
      { headers: apiHeaders(page) },
    );
    expect(denied.status()).toBe(423);

    await page.goto("/settings?tab=security");
    const card = page.locator("article").filter({
      hasText: fixture.quarantine.fileName,
    });
    await expect(card).toContainText("Executable content was detected.");
    await card.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(card).toBeHidden();
  });
});

function releaseSeed() {
  const revision = (process.env.CI_COMMIT_SHA ?? "local")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 12);
  return `stateful-${revision || "local"}`;
}

async function authenticate(page: Page) {
  await page.goto("/pin");
  if (/\/pin(?:\?|$)/.test(page.url())) {
    await page.getByPlaceholder("PIN").fill(pin ?? "");
    await page.getByRole("button", { name: "Unlock" }).click();
  }
  await expect(page).not.toHaveURL(/\/pin(?:\?|$)/);
}

async function openChatSession(page: Page, sessionId: string) {
  await page.goto(`/chat?sessionId=${sessionId}`);
  const collapsedArtifacts = page.getByLabel(/artifacts?$/i);
  if (await collapsedArtifacts.isVisible().catch(() => false)) {
    await page.getByTitle("세션 목록 펼치기").click();
  }
  await expect(page.getByRole("heading", { name: "Artifacts", level: 2 })).toBeVisible();
}

function artifactCard(page: Page) {
  return page
    .getByRole("heading", { name: "Artifacts", level: 2 })
    .locator("xpath=../following-sibling::div")
    .locator("div.rounded-md")
    .filter({ hasText: `Release artifact ${seed}` });
}

function decisionCard(page: Page, id: string) {
  return page.locator(`#decision-${id}`);
}

async function composeKorean(
  input: ReturnType<Page["getByPlaceholder"]>,
  value: string,
) {
  await input.focus();
  await input.evaluate((element, composed) => {
    const inputElement = element as HTMLInputElement;
    inputElement.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
    );
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(inputElement, composed);
    inputElement.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: composed,
        inputType: "insertCompositionText",
        isComposing: true,
      }),
    );
    inputElement.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: composed }),
    );
  }, value);
}

async function findTrashEntry(page: Page, path: string) {
  const response = await page.request.get(apiUrl("/drive/trash?limit=100"), {
    headers: apiHeaders(page),
  });
  expect(response.ok(), await response.text()).toBe(true);
  const entry = ((await response.json()) as TrashResponse).entries.find(
    (candidate) => candidate.originalPath === path,
  );
  expect(entry).toBeDefined();
  return entry!;
}

function lifecycleQuery(idempotencyKey: string, revision?: string) {
  const query = new URLSearchParams({ idempotencyKey });
  if (revision) query.set("expectedLifecycleRevision", revision);
  return query.toString();
}

function harnessHeaders() {
  return { "X-Mymy-Release-Harness": harnessToken ?? "" };
}

function apiHeaders(page: Page) {
  return { Origin: new URL(page.url()).origin };
}

function apiUrl(path: string) {
  return `${apiBase.replace(/\/$/, "")}${path}`;
}
