import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Loader2,
  Search,
} from "lucide-react";
import { hostnameFromUrl, truncateText } from "./toolResultUtils";

import type { WebExtractResult, WebSearchItem, WebSearchResult } from "./toolResultWebParsers";

export function WebSearchResultPanel({
  result,
  status,
}: {
  result: WebSearchResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visibleResults = expanded ? result.results : result.results.slice(0, 3);
  const hiddenCount = Math.max(result.results.length - visibleResults.length, 0);

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <div className="flex items-center gap-2">
        {status === "running" ? (
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
        ) : (
          <Search className="h-3.5 w-3.5 text-[#a3e635]" strokeWidth={1.75} />
        )}
        <span className="font-medium text-[var(--text)]">
          {t("chat.webSearchTitle")}
        </span>
        <span>
          {t("chat.webSearchResultCount", { count: result.results.length })}
        </span>
      </div>
      {result.query && (
        <div className="mt-1 break-words text-sm text-[var(--text)]">
          {result.query}
        </div>
      )}
      <div className="mt-2 grid gap-2">
        {visibleResults.map((item, index) => (
          <WebSearchResultItem key={`${item.url}:${index}`} item={item} />
        ))}
      </div>
      {hiddenCount > 0 || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--accent-hover)] hover:underline"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" strokeWidth={1.5} />
              {t("chat.showLess")}
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
              {t("chat.showMoreResults", { count: hiddenCount })}
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}

function WebSearchResultItem({ item }: { item: WebSearchItem }) {
  const host = hostnameFromUrl(item.url);
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm font-medium text-[var(--text)]">
            {item.title || item.url}
          </div>
          {host && (
            <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-faint)]">
              {host}
            </div>
          )}
        </div>
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            aria-label="Open result"
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
          </a>
        )}
      </div>
      {item.content && (
        <div className="mt-1 line-clamp-3 break-words text-xs leading-relaxed text-[var(--text-muted)]">
          {item.content}
        </div>
      )}
    </div>
  );
}

export function WebExtractResultPanel({
  result,
  status,
}: {
  result: WebExtractResult;
  status: "running" | "done";
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const text = expanded ? result.text : truncateText(result.text, 1200);
  const canExpand = result.text.length > text.length;

  return (
    <div className="max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <div className="flex items-center gap-2">
        {status === "running" ? (
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
        ) : (
          <FileText className="h-3.5 w-3.5 text-[#a3e635]" strokeWidth={1.75} />
        )}
        <span className="font-medium text-[var(--text)]">
          {t("chat.webExtractTitle")}
        </span>
        {result.status !== undefined && (
          <span>{t("chat.httpStatus", { status: result.status })}</span>
        )}
      </div>
      {result.url && (
        <a
          href={result.url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 block truncate font-mono text-[10px] text-[var(--accent-hover)] hover:underline"
        >
          {result.url}
        </a>
      )}
      {text && (
        <div className="mt-2 whitespace-pre-wrap break-words rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs leading-relaxed text-[var(--text-muted)]">
          {text}
        </div>
      )}
      {canExpand || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--accent-hover)] hover:underline"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" strokeWidth={1.5} />
              {t("chat.showLess")}
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
              {t("chat.showMore")}
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}
