import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  RefreshCw,
  Shield,
} from "lucide-react";
import { API_BASE } from "@/lib/api";
import { driveHtmlViewerUrl } from "@/features/drive/api";

interface BrowserHistoryEntry {
  url: string;
  label: string;
}

export type LightweightBrowserSource =
  | { kind: "drive-html"; path: string }
  | { kind: "process-url"; url: string; label: string };

type LightweightBrowserPaneProps =
  | { path: string; source?: never }
  | { path?: never; source: LightweightBrowserSource };

export function LightweightBrowserPane({
  path,
  source,
}: LightweightBrowserPaneProps) {
  const resolvedSource = source ?? { kind: "drive-html" as const, path };
  return (
    <LightweightBrowserSession
      key={browserSourceKey(resolvedSource)}
      source={resolvedSource}
    />
  );
}

function LightweightBrowserSession({
  source,
}: {
  source: LightweightBrowserSource;
}) {
  const { t } = useTranslation();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const initialEntry = useMemo(() => browserEntryForSource(source), [source]);
  const [history, setHistory] = useState<BrowserHistoryEntry[]>([initialEntry]);
  const [index, setIndex] = useState(0);
  const [blockedExternalUrl, setBlockedExternalUrl] = useState<string | null>(null);
  const current = history[index] ?? initialEntry;

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!isViewerNavigateMessage(data)) return;
      const url = normalizeViewerUrl(data.href);
      if (!url) {
        const externalUrl = externalViewerUrl(data.href);
        if (externalUrl) setBlockedExternalUrl(externalUrl);
        return;
      }
      setBlockedExternalUrl(null);
      setHistory((currentHistory) => {
        const next = [
          ...currentHistory.slice(0, index + 1),
          { url, label: labelFromViewerUrl(url) },
        ];
        setIndex(next.length - 1);
        return next;
      });
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [index]);

  function reload() {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.src = current.url;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <button
          type="button"
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
          disabled={index <= 0}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          title={t("common.back")}
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() =>
            setIndex((value) => Math.min(history.length - 1, value + 1))
          }
          disabled={index >= history.length - 1}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          title={t("browser.forward")}
        >
          <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={reload}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          title={t("browser.reload")}
        >
          <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-muted)]">
          <Shield className="h-3.5 w-3.5 shrink-0 text-[var(--status-success)]" strokeWidth={1.75} />
          <span className="truncate font-mono">{current.label}</span>
        </div>
        <a
          href={current.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          title={t("browser.openInNewTab")}
        >
          <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
        </a>
      </div>
      {blockedExternalUrl && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--status-warning)]/10 px-3 py-2 text-xs text-[var(--status-warning)]">
          <Shield className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">
            {t("browser.externalLinkBlocked", { url: blockedExternalUrl })}
          </span>
          <a
            href={blockedExternalUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => setBlockedExternalUrl(null)}
            className="shrink-0 rounded-md border border-[var(--status-warning)]/40 px-2 py-1 text-[var(--status-warning)] hover:bg-[var(--status-warning)]/10"
          >
            {t("common.open")}
          </a>
          <button
            type="button"
            onClick={() => setBlockedExternalUrl(null)}
            className="shrink-0 rounded-md px-2 py-1 hover:bg-[var(--status-warning)]/10"
          >
            {t("common.dismiss")}
          </button>
        </div>
      )}
      <iframe
        ref={iframeRef}
        key={current.url}
        src={current.url}
        title={current.label}
        sandbox="allow-scripts allow-forms allow-popups-by-user-activation"
        referrerPolicy="no-referrer"
        className="min-h-0 flex-1 border-0 bg-white"
      />
    </div>
  );
}

function browserSourceKey(source: LightweightBrowserSource) {
  if (source.kind === "drive-html") return `drive-html:${source.path}`;
  return `process-url:${source.url}`;
}

function browserEntryForSource(source: LightweightBrowserSource): BrowserHistoryEntry {
  if (source.kind === "drive-html") {
    return { url: driveHtmlViewerUrl(source.path), label: source.path };
  }
  return { url: normalizeInitialBrowserUrl(source.url), label: source.label };
}

function normalizeInitialBrowserUrl(url: string) {
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return "about:blank";
  }
  return "about:blank";
}

function isViewerNavigateMessage(
  value: unknown,
): value is { type: "mymy-web-viewer:navigate"; href: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.type === "mymy-web-viewer:navigate" &&
    typeof record.href === "string"
  );
}

function normalizeViewerUrl(href: string) {
  try {
    const url = new URL(href, window.location.href);
    if (!isViewerPath(url.pathname) || !isAllowedViewerOrigin(url)) {
      return null;
    }
    const base = apiOrigin();
    return `${base}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function externalViewerUrl(href: string) {
  try {
    const url = new URL(href, window.location.href);
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (isViewerPath(url.pathname) && isAllowedViewerOrigin(url)) {
        return null;
      }
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function apiOrigin() {
  if (API_BASE.startsWith("http://") || API_BASE.startsWith("https://")) {
    return API_BASE.replace(/\/api$/, "");
  }
  return "";
}

function isViewerPath(pathname: string) {
  return (
    pathname === "/api/web-viewer/drive" ||
    pathname.startsWith("/api/web-viewer/assets/")
  );
}

function isAllowedViewerOrigin(url: URL) {
  const origin = apiOrigin();
  if (!origin) return url.origin === window.location.origin;
  return url.origin === new URL(origin, window.location.href).origin;
}

function labelFromViewerUrl(url: string) {
  try {
    const parsed = new URL(url, window.location.href);
    const path = parsed.searchParams.get("path");
    if (path) return path;
    const asset = parsed.pathname.split("/api/web-viewer/assets/").at(1);
    const root = parsed.searchParams.get("root");
    if (asset && root) {
      return `${root.replace(/\/$/, "")}/${decodeURIComponent(asset).replace(/^\//, "")}`;
    }
    return asset ? decodeURIComponent(asset) : parsed.pathname;
  } catch {
    return url;
  }
}
