import { useTranslation } from "react-i18next";
import { HighlightedCodeBlock } from "@/components/chat/shared/codeHighlight";
import { cn } from "@/lib/utils";
import { isRecord } from "../shared/models";
import { jsonPreviewTypeClass } from "./textJsonUtils";

interface JsonPreviewRow {
  path: string;
  key: string;
  type: string;
  value: string;
  depth: number;
  summary: string;
}

export function JsonPreview({ content }: { content: string }) {
  const { t } = useTranslation();
  let parsed: unknown;
  try {
    parsed = JSON.parse(content || "null");
  } catch {
    return (
      <div className="h-full min-h-0 overflow-auto bg-[var(--bg)] p-4">
        <div className="mb-3 rounded-md border border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-3 py-2 text-xs text-[var(--status-error)]">
          {t("documentEditor.invalidJson")}
        </div>
        <HighlightedCodeBlock code={content} language="json" />
      </div>
    );
  }

  const rows = flattenJsonPreviewRows(parsed);
  const rootType = jsonPreviewType(parsed);

  return (
    <div className="h-full min-h-0 overflow-auto bg-[var(--bg)] p-4" tabIndex={0}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
        <span className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono">
          {rootType}
        </span>
        <span>
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
        </span>
      </div>
      <table className="w-full min-w-[720px] border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-[var(--text-faint)]">
            <th className="sticky top-0 z-10 w-[34%] bg-[var(--surface)] px-3 py-2 font-medium">
              Path
            </th>
            <th className="sticky top-0 z-10 w-[18%] bg-[var(--surface)] px-3 py-2 font-medium">
              Key
            </th>
            <th className="sticky top-0 z-10 w-[12%] bg-[var(--surface)] px-3 py-2 font-medium">
              Type
            </th>
            <th className="sticky top-0 z-10 bg-[var(--surface)] px-3 py-2 font-medium">
              Value
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={`${rowIndex}:${row.path}`}
              className="border-b border-[var(--border)]/70 hover:bg-[var(--surface-hover)]"
            >
              <td className="max-w-0 px-3 py-2 align-top">
                <code
                  className="block truncate font-mono text-[11px] text-[var(--text-muted)]"
                  title={row.path}
                  style={{ paddingLeft: `${Math.min(row.depth, 8) * 10}px` }}
                >
                  {row.path}
                </code>
              </td>
              <td className="max-w-0 px-3 py-2 align-top">
                <span className="block truncate font-mono text-[11px] font-medium text-[var(--accent)]">
                  {row.key}
                </span>
              </td>
              <td className="px-3 py-2 align-top">
                <span className={jsonPreviewTypeClass(row.type)}>{row.type}</span>
              </td>
              <td className="max-w-0 px-3 py-2 align-top">
                <span
                  className={cn(
                    "block truncate font-mono text-[11px]",
                    row.value ? "text-[var(--text)]" : "text-[var(--text-faint)]",
                  )}
                  title={row.value || row.summary}
                >
                  {row.value || row.summary}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function flattenJsonPreviewRows(value: unknown) {
  const rows: JsonPreviewRow[] = [];
  visitJsonPreviewValue(value, "$", "root", 0, rows);
  return rows;
}

function visitJsonPreviewValue(
  value: unknown,
  path: string,
  key: string,
  depth: number,
  rows: JsonPreviewRow[],
) {
  const type = jsonPreviewType(value);
  rows.push({
    path,
    key,
    type,
    value: jsonPreviewPrimitiveValue(value),
    depth,
    summary: jsonPreviewSummary(value),
  });
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      visitJsonPreviewValue(item, `${path}[${index}]`, `[${index}]`, depth + 1, rows),
    );
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([entryKey, item]) =>
      visitJsonPreviewValue(
        item,
        `${path}.${entryKey}`,
        entryKey,
        depth + 1,
        rows,
      ),
    );
  }
}

function jsonPreviewType(value: unknown) {
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  if (value === null) return "null";
  return typeof value;
}

function jsonPreviewPrimitiveValue(value: unknown) {
  if (Array.isArray(value) || isRecord(value)) return "";
  if (typeof value === "string") return value;
  if (value === null) return "null";
  return String(value);
}

function jsonPreviewSummary(value: unknown) {
  if (Array.isArray(value)) return `${value.length} items`;
  if (isRecord(value)) {
    const count = Object.keys(value).length;
    return `${count} ${count === 1 ? "key" : "keys"}`;
  }
  return "";
}
