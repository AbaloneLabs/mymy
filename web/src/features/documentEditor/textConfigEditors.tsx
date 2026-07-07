import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { JsonDeleteButton, JsonIconButton } from "./textJsonEditors";
import { jsonPreviewTypeClass } from "./textJsonPreviewUtils";
import {
  appendFlatConfigEntry,
  configEntryParentLabel,
  configEntryPathLabel,
  configScalarType,
  flatConfigLine,
  parseFlatConfig,
} from "./textStructuredUtils";
import type { ConfigEntry } from "./textStructuredUtils";

const LARGE_TEXT_LINE_HEIGHT = 24;
const LARGE_TEXT_OVERSCAN_LINES = 24;

export function FlatConfigEditor({
  kind,
  content,
  onChangeContent,
}: {
  kind: "yaml" | "toml";
  content: string;
  onChangeContent: (content: string) => void;
}) {
  const { t } = useTranslation();
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newSection, setNewSection] = useState("");
  const parsed = parseFlatConfig(content, kind);

  function updateLine(entry: ConfigEntry, key: string, value: string) {
    const cleanKey = key.trim();
    if (entry.keyEditable && !cleanKey) return;
    const lines = content.split("\n");
    lines[entry.lineIndex] = flatConfigLine(entry, cleanKey, value, kind);
    onChangeContent(lines.join("\n"));
  }

  function deleteLine(lineIndex: number) {
    const lines = content.split("\n");
    lines.splice(lineIndex, 1);
    onChangeContent(lines.join("\n"));
  }

  function duplicateLine(lineIndex: number) {
    const lines = content.split("\n");
    lines.splice(lineIndex + 1, 0, lines[lineIndex] ?? "");
    onChangeContent(lines.join("\n"));
  }

  function moveLine(lineIndex: number, direction: -1 | 1) {
    const lines = content.split("\n");
    const nextIndex = lineIndex + direction;
    if (nextIndex < 0 || nextIndex >= lines.length) return;
    const [line] = lines.splice(lineIndex, 1);
    lines.splice(nextIndex, 0, line);
    onChangeContent(lines.join("\n"));
  }

  function addEntry() {
    const cleanKey = newKey.trim();
    if (!cleanKey) return;
    onChangeContent(
      appendFlatConfigEntry(content, {
        key: cleanKey,
        kind,
        section: newSection.trim(),
        value: newValue,
      }),
    );
    setNewKey("");
    setNewValue("");
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        {kind === "toml" && (
          <input
            value={newSection}
            onChange={(event) => setNewSection(event.target.value)}
            placeholder="section"
            className="h-8 min-w-32 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        )}
        {kind === "yaml" && (
          <input
            value={newSection}
            onChange={(event) => setNewSection(event.target.value)}
            placeholder="parent.path"
            className="h-8 min-w-32 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        )}
        <input
          value={newKey}
          onChange={(event) => setNewKey(event.target.value)}
          placeholder={t("common.name")}
          className="h-8 min-w-40 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
        <input
          value={newValue}
          onChange={(event) => setNewValue(event.target.value)}
          placeholder={t("documentEditor.value", { defaultValue: "Value" })}
          className="h-8 min-w-48 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
        <button
          type="button"
          onClick={addEntry}
          disabled={!newKey.trim()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("common.add")}
        </button>
        {parsed.unsupportedCount > 0 && (
          <span className="text-xs text-[var(--text-faint)]">
            {parsed.unsupportedCount} preserved source lines
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="space-y-2">
          {parsed.entries.map((entry) => (
            <div
              key={`${entry.lineIndex}:${entry.key}`}
              className="grid gap-2 md:grid-cols-[minmax(120px,220px)_minmax(120px,220px)_minmax(0,1fr)_auto]"
            >
              <span
                className="min-w-0 truncate rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono text-xs text-[var(--text-faint)]"
                title={configEntryPathLabel(entry)}
              >
                {configEntryParentLabel(entry)}
              </span>
              <input
                value={entry.key}
                onChange={(event) => updateLine(entry, event.target.value, entry.value)}
                disabled={!entry.keyEditable}
                className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-xs font-medium text-[var(--accent)] outline-none focus:border-[var(--accent)] disabled:text-[var(--text-faint)]"
              />
              <input
                value={entry.value}
                onChange={(event) => updateLine(entry, entry.key, event.target.value)}
                className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
              <div className="flex items-center gap-1">
                <JsonIconButton
                  disabled={entry.lineIndex <= 0}
                  icon={ArrowUp}
                  label="Move entry up"
                  onClick={() => moveLine(entry.lineIndex, -1)}
                />
                <JsonIconButton
                  disabled={entry.lineIndex >= content.split("\n").length - 1}
                  icon={ArrowDown}
                  label="Move entry down"
                  onClick={() => moveLine(entry.lineIndex, 1)}
                />
                <JsonIconButton
                  icon={Copy}
                  label="Duplicate entry"
                  onClick={() => duplicateLine(entry.lineIndex)}
                />
                <JsonDeleteButton onClick={() => deleteLine(entry.lineIndex)} />
              </div>
            </div>
          ))}
          {parsed.entries.length === 0 && (
            <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-8 text-center text-sm text-[var(--text-faint)]">
              No editable top-level key/value pairs.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ConfigPreview({
  kind,
  content,
}: {
  kind: "yaml" | "toml";
  content: string;
}) {
  const parsed = parseFlatConfig(content, kind);
  const rows = parsed.entries.map((entry) => ({
    path: configEntryPathLabel(entry),
    key: entry.key,
    type: configScalarType(entry.value),
    value: entry.value,
  }));

  return (
    <div className="h-full min-h-0 overflow-auto bg-[var(--bg)] p-4" tabIndex={0}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
        <span className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono uppercase">
          {kind}
        </span>
        <span>
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-8 text-center text-sm text-[var(--text-faint)]">
          No previewable key/value entries.
        </div>
      ) : (
        <table className="w-full min-w-[720px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-[var(--text-faint)]">
              <th className="sticky top-0 z-10 w-[38%] bg-[var(--surface)] px-3 py-2 font-medium">
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
                    title={row.value}
                  >
                    {row.value || "(empty)"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function LargeTextSourceViewer({
  content,
  lineCount,
}: {
  content: string;
  lineCount: number;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ height: 0, scrollTop: 0 });
  const lines = useMemo(() => content.split("\n"), [content]);
  const visibleLineCount = Math.ceil(viewport.height / LARGE_TEXT_LINE_HEIGHT);
  const start = Math.max(
    0,
    Math.floor(viewport.scrollTop / LARGE_TEXT_LINE_HEIGHT) - LARGE_TEXT_OVERSCAN_LINES,
  );
  const end = Math.min(
    lines.length,
    start + visibleLineCount + LARGE_TEXT_OVERSCAN_LINES * 2,
  );
  const top = start * LARGE_TEXT_LINE_HEIGHT;

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    setViewport({ height: element.clientHeight, scrollTop: element.scrollTop });
  }, []);

  return (
    <div
      ref={viewportRef}
      onScroll={(event) =>
        setViewport({
          height: event.currentTarget.clientHeight,
          scrollTop: event.currentTarget.scrollTop,
        })
      }
      className="h-full min-h-0 overflow-auto bg-[var(--bg)] font-mono text-sm text-[var(--text)]"
    >
      <div
        className="relative min-w-max"
        style={{ height: Math.max(1, lineCount) * LARGE_TEXT_LINE_HEIGHT }}
      >
        <div
          className="absolute left-0 right-0 grid grid-cols-[auto_minmax(0,1fr)]"
          style={{ transform: `translateY(${top}px)` }}
        >
          {lines.slice(start, end).map((line, offset) => {
            const lineNumber = start + offset + 1;
            return (
              <div key={lineNumber} className="contents">
                <div
                  className="select-none border-r border-[var(--border)] bg-[var(--surface)] px-3 text-right text-xs leading-6 text-[var(--text-faint)]"
                  style={{ height: LARGE_TEXT_LINE_HEIGHT }}
                >
                  {lineNumber}
                </div>
                <pre
                  className="m-0 whitespace-pre px-4 text-sm leading-6"
                  style={{ height: LARGE_TEXT_LINE_HEIGHT }}
                >
                  {line || " "}
                </pre>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
