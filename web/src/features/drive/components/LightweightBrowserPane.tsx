import { useEffect, useMemo, useRef, useState } from "react";
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

export function LightweightBrowserPane({
  path,
}: {
  path: string;
}) {
  return <LightweightBrowserSession key={path} path={path} />;
}

function LightweightBrowserSession({
  path,
}: {
  path: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const initialEntry = useMemo(
    () => ({ url: driveHtmlViewerUrl(path), label: path }),
    [path],
  );
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
          title="Back"
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
          title="Forward"
        >
          <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={reload}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          title="Reload"
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
          title="Open in new tab"
        >
          <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
        </a>
      </div>
      {blockedExternalUrl && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--status-warning)]/10 px-3 py-2 text-xs text-[var(--status-warning)]">
          <Shield className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">
            External link blocked: {blockedExternalUrl}
          </span>
          <a
            href={blockedExternalUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => setBlockedExternalUrl(null)}
            className="shrink-0 rounded-md border border-[var(--status-warning)]/40 px-2 py-1 text-[var(--status-warning)] hover:bg-[var(--status-warning)]/10"
          >
            Open
          </a>
          <button
            type="button"
            onClick={() => setBlockedExternalUrl(null)}
            className="shrink-0 rounded-md px-2 py-1 hover:bg-[var(--status-warning)]/10"
          >
            Dismiss
          </button>
        </div>
      )}
      <iframe
        ref={iframeRef}
        key={current.url}
        src={current.url}
        title={current.label}
        sandbox="allow-scripts allow-forms allow-popups-by-user-activation"
        className="min-h-0 flex-1 border-0 bg-white"
      />
    </div>
  );
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
    if (url.pathname !== "/api/web-viewer/drive" && !url.pathname.startsWith("/api/web-viewer/assets/")) {
      return null;
    }
    const base = apiOrigin();
    return `${base}${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function externalViewerUrl(href: string) {
  try {
    const url = new URL(href, window.location.href);
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (url.pathname === "/api/web-viewer/drive" || url.pathname.startsWith("/api/web-viewer/assets/")) {
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

function labelFromViewerUrl(url: string) {
  try {
    const parsed = new URL(url, window.location.href);
    const path = parsed.searchParams.get("path");
    if (path) return path;
    const asset = parsed.pathname.split("/api/web-viewer/assets/").at(1);
    return asset ? decodeURIComponent(asset) : parsed.pathname;
  } catch {
    return url;
  }
}
