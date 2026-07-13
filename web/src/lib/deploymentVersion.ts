const DEPLOYMENT_CHECK_INTERVAL_MS = 60_000;
const ROUTE_RECOVERY_WINDOW_MS = 5 * 60_000;
const ROUTE_RECOVERY_KEY = "mymy:stale-route-recovery";

/**
 * Read the production entry module without assuming Vite's attribute order.
 *
 * A running tab retains the entry module that created its React tree. Comparing
 * that immutable URL with a no-store fetch of the current HTML gives the client
 * a deployment signal without adding a second version endpoint or coupling the
 * frontend build to Git metadata that may be unavailable in local Docker builds.
 */
export function entryModuleSource(html: string): string | undefined {
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\btype\s*=\s*["']module["']/i.test(tag)) continue;
    const source = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (source) return source;
  }
  return undefined;
}

export function deploymentEntryChanged(
  runningEntry: string,
  currentHtml: string,
): boolean {
  const deployedEntry = entryModuleSource(currentHtml);
  return Boolean(deployedEntry && deployedEntry !== runningEntry);
}

/**
 * Refresh a long-lived tab when the server starts serving a different Vite
 * entry module. Route chunks and API payload contracts are released together,
 * so keeping the old tree alive after this point can produce both chunk 404s
 * and requests that the current API can no longer deserialize.
 */
export function installDeploymentVersionGuard(): () => void {
  const runningEntry = document
    .querySelector<HTMLScriptElement>('script[type="module"][src]')
    ?.getAttribute("src");
  if (!runningEntry) return () => undefined;

  let checking = false;
  let disposed = false;
  const check = async () => {
    if (checking || disposed) return;
    checking = true;
    try {
      const response = await fetch("/", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) return;
      if (deploymentEntryChanged(runningEntry, await response.text())) {
        window.location.reload();
      }
    } catch {
      // A transient network failure is not a deployment signal. The next
      // interval, focus, or visibility transition retries without disrupting
      // the user's current work.
    } finally {
      checking = false;
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") void check();
  };
  const interval = window.setInterval(() => void check(), DEPLOYMENT_CHECK_INTERVAL_MS);
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    disposed = true;
    window.clearInterval(interval);
    window.removeEventListener("focus", check);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

export function isDynamicImportFailure(error: Error): boolean {
  const message = error.message.toLowerCase();
  return [
    "failed to fetch dynamically imported module",
    "error loading dynamically imported module",
    "importing a module script failed",
    "loading chunk",
  ].some((fragment) => message.includes(fragment));
}

interface RouteRecoveryRecord {
  href: string;
  attemptedAt: number;
}

export function routeRecoveryAllowed(
  stored: string | null,
  href: string,
  now: number,
): boolean {
  if (!stored) return true;
  try {
    const previous = JSON.parse(stored) as Partial<RouteRecoveryRecord>;
    return (
      previous.href !== href ||
      typeof previous.attemptedAt !== "number" ||
      now - previous.attemptedAt >= ROUTE_RECOVERY_WINDOW_MS
    );
  } catch {
    return true;
  }
}

/** Reload at most once per route and recovery window after a chunk failure. */
export function reloadStaleRouteOnce(error: Error): boolean {
  if (!isDynamicImportFailure(error)) return false;
  const href = `${window.location.pathname}${window.location.search}`;
  const now = Date.now();
  try {
    if (!routeRecoveryAllowed(sessionStorage.getItem(ROUTE_RECOVERY_KEY), href, now)) {
      return false;
    }
    sessionStorage.setItem(
      ROUTE_RECOVERY_KEY,
      JSON.stringify({ href, attemptedAt: now } satisfies RouteRecoveryRecord),
    );
  } catch {
    // Without session storage there is no reliable loop guard, so leave the
    // explicit recovery screen in place instead of risking reload churn.
    return false;
  }
  window.location.reload();
  return true;
}
