import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Plus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { JsonDeleteButton, JsonIconButton } from "./textJsonEditorControls";
import { jsonPreviewTypeClass } from "./textJsonPreviewUtils";
import {
  appendFlatConfigEntry,
  configEntryPathLabel,
  configEntryLineRange,
  configScalarType,
  deleteFlatConfigGroup,
  duplicateFlatConfigEntry,
  flatConfigEntryCanDuplicate,
  flatConfigEntryCanMove,
  flatConfigLines,
  joinStructuredTextLines,
  moveFlatConfigEntry,
  parseFlatConfig,
  splitStructuredTextLines,
} from "./textStructuredUtils";
import type { ConfigEntry } from "./textStructuredUtils";
import type { SourceSelectionRange } from "./textSourceUtils";

const LARGE_TEXT_LINE_HEIGHT = 24;
const LARGE_TEXT_OVERSCAN_LINES = 24;

interface ConfigTreeNode {
  path: string[];
  label: string;
  children: ConfigTreeNode[];
  entries: ConfigEntry[];
  firstLineIndex: number;
}

function buildConfigTree(entries: ConfigEntry[]) {
  const root: ConfigTreeNode = {
    path: [],
    label: "root",
    children: [],
    entries: [],
    firstLineIndex: Number.POSITIVE_INFINITY,
  };
  const nodes = new Map<string, ConfigTreeNode>([[configTreePathKey([]), root]]);

  function nodeFor(path: string[]) {
    const key = configTreePathKey(path);
    const existing = nodes.get(key);
    if (existing) return existing;
    const parent = nodeFor(path.slice(0, -1));
    const node: ConfigTreeNode = {
      path,
      label: path.at(-1) ?? "root",
      children: [],
      entries: [],
      firstLineIndex: Number.POSITIVE_INFINITY,
    };
    parent.children.push(node);
    nodes.set(key, node);
    return node;
  }

  entries.forEach((entry) => {
    const parent = nodeFor(entry.path.slice(0, -1));
    parent.entries.push(entry);
    for (let index = 0; index <= entry.path.length - 1; index += 1) {
      const node = nodeFor(entry.path.slice(0, index));
      node.firstLineIndex = Math.min(node.firstLineIndex, entry.lineIndex);
    }
    parent.firstLineIndex = Math.min(parent.firstLineIndex, entry.lineIndex);
  });

  nodes.forEach((node) => {
    node.children.sort((left, right) => left.firstLineIndex - right.firstLineIndex);
    node.entries.sort((left, right) => left.lineIndex - right.lineIndex);
  });

  return root;
}

function configTreePathKey(path: string[]) {
  return path.join("\u0000");
}

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
  const [collapsedPathKeys, setCollapsedPathKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const parsed = parseFlatConfig(content, kind);
  const tree = useMemo(() => buildConfigTree(parsed.entries), [parsed.entries]);

  function updateLine(entry: ConfigEntry, key: string, value: string) {
    const cleanKey = key.trim();
    if (entry.keyEditable && !cleanKey) return;
    const lines = splitStructuredTextLines(content);
    const range = configEntryLineRange(entry);
    lines.splice(
      range.start,
      range.end - range.start,
      ...flatConfigLines(entry, cleanKey, value, kind),
    );
    onChangeContent(joinStructuredTextLines(lines, content));
  }

  function deleteEntry(entry: ConfigEntry) {
    const lines = splitStructuredTextLines(content);
    const range = configEntryLineRange(entry);
    lines.splice(range.start, range.end - range.start);
    onChangeContent(joinStructuredTextLines(lines, content));
  }

  function duplicateEntry(entry: ConfigEntry) {
    onChangeContent(duplicateFlatConfigEntry(content, entry, kind));
  }

  function moveEntry(entry: ConfigEntry, direction: -1 | 1) {
    onChangeContent(moveFlatConfigEntry(content, parsed.entries, entry, direction));
  }

  function addEntry() {
    const cleanKey = newKey.trim();
    if (!cleanKey || !newValue.trim()) return;
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

  function prepareChildEntry(path: string[]) {
    setNewSection(path.join("."));
    setNewKey("");
    setNewValue("");
  }

  function deleteGroup(path: string[]) {
    onChangeContent(deleteFlatConfigGroup(content, kind, path));
  }

  const canAddEntry = Boolean(newKey.trim() && newValue.trim());

  function toggleCollapsed(path: string[]) {
    const key = configTreePathKey(path);
    setCollapsedPathKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderEntry(entry: ConfigEntry, depth: number) {
    return (
      <div
        key={`${entry.lineIndex}:${entry.key}`}
        className="grid gap-2 md:grid-cols-[minmax(110px,180px)_minmax(80px,100px)_minmax(0,1fr)_auto]"
        style={{ paddingLeft: depth * 16 }}
      >
        <input
          value={entry.key}
          onChange={(event) => updateLine(entry, event.target.value, entry.value)}
          disabled={!entry.keyEditable}
          className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-xs font-medium text-[var(--accent)] outline-none focus:border-[var(--accent)] disabled:text-[var(--text-faint)]"
        />
        <span
          className={cn(
            "min-w-0 truncate rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs",
            jsonPreviewTypeClass(configScalarType(entry.value)),
          )}
        >
          {configScalarType(entry.value)}
        </span>
        {entry.valueStyle ? (
          <textarea
            value={entry.value}
            onChange={(event) => updateLine(entry, entry.key, event.target.value)}
            rows={Math.min(8, Math.max(3, entry.value.split("\n").length))}
            className="min-w-0 resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        ) : (
          <input
            value={entry.value}
            onChange={(event) => updateLine(entry, entry.key, event.target.value)}
            className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        )}
        <div className="flex items-center gap-1">
          <JsonIconButton
            disabled={!flatConfigEntryCanMove(parsed.entries, entry, -1)}
            icon={ArrowUp}
            label="Move entry up"
            onClick={() => moveEntry(entry, -1)}
          />
          <JsonIconButton
            disabled={!flatConfigEntryCanMove(parsed.entries, entry, 1)}
            icon={ArrowDown}
            label="Move entry down"
            onClick={() => moveEntry(entry, 1)}
          />
          <JsonIconButton
            disabled={!flatConfigEntryCanDuplicate(entry)}
            icon={Copy}
            label="Duplicate entry"
            onClick={() => duplicateEntry(entry)}
          />
          <JsonDeleteButton onClick={() => deleteEntry(entry)} />
        </div>
      </div>
    );
  }

  function renderNode(node: ConfigTreeNode, depth = 0): ReactNode[] {
    return node.children.flatMap((child) => {
      const collapsed = collapsedPathKeys.has(configTreePathKey(child.path));
      return [
        <div
          key={`group:${configTreePathKey(child.path)}`}
          className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono text-xs text-[var(--text-muted)]"
          style={{ marginLeft: depth * 16 }}
        >
          <button
            type="button"
            onClick={() => toggleCollapsed(child.path)}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
          </button>
          <span className="min-w-0 flex-1 truncate" title={child.path.join(".")}>
            {child.label}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
            {child.entries.length + child.children.length}
          </span>
          <JsonIconButton
            icon={Plus}
            label="Add child entry"
            onClick={() => prepareChildEntry(child.path)}
          />
          <JsonDeleteButton onClick={() => deleteGroup(child.path)} />
        </div>,
        ...(collapsed
          ? []
          : [
              ...child.entries.map((entry) => renderEntry(entry, depth + 1)),
              ...renderNode(child, depth + 1),
            ]),
      ];
    });
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
          disabled={!canAddEntry}
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
          {tree.entries.map((entry) => renderEntry(entry, 0))}
          {renderNode(tree)}
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
  searchRange,
}: {
  content: string;
  lineCount: number;
  searchRange?: SourceSelectionRange | null;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ height: 0, scrollTop: 0 });
  const lines = useMemo(() => content.split("\n"), [content]);
  const lineOffsets = useMemo(() => largeTextLineOffsets(lines), [lines]);
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

  useEffect(() => {
    if (!searchRange) return;
    const element = viewportRef.current;
    if (!element) return;
    const lineIndex = lineIndexForOffset(lineOffsets, searchRange.start);
    const nextScrollTop = Math.max(
      0,
      (lineIndex - LARGE_TEXT_OVERSCAN_LINES) * LARGE_TEXT_LINE_HEIGHT,
    );
    element.scrollTop = nextScrollTop;
    setViewport({ height: element.clientHeight, scrollTop: nextScrollTop });
  }, [lineOffsets, searchRange]);

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
            const lineStart = lineOffsets[lineNumber - 1] ?? 0;
            const lineEnd = lineStart + line.length;
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
                  <LargeTextLineContent
                    line={line}
                    lineStart={lineStart}
                    lineEnd={lineEnd}
                    searchRange={searchRange}
                  />
                </pre>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LargeTextLineContent({
  line,
  lineStart,
  lineEnd,
  searchRange,
}: {
  line: string;
  lineStart: number;
  lineEnd: number;
  searchRange?: SourceSelectionRange | null;
}) {
  if (!searchRange || searchRange.end <= lineStart || searchRange.start > lineEnd) {
    return line || " ";
  }
  const startColumn = Math.max(0, searchRange.start - lineStart);
  const endColumn = Math.max(startColumn, Math.min(line.length, searchRange.end - lineStart));
  if (startColumn === endColumn) return line || " ";
  return (
    <>
      {line.slice(0, startColumn)}
      <mark className="rounded-sm bg-[var(--accent)]/30 px-0 text-[var(--text)]">
        {line.slice(startColumn, endColumn)}
      </mark>
      {line.slice(endColumn) || " "}
    </>
  );
}

function lineIndexForOffset(lineOffsets: number[], offset: number) {
  let low = 0;
  let high = Math.max(0, lineOffsets.length - 1);
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const current = lineOffsets[mid] ?? 0;
    const next = lineOffsets[mid + 1] ?? Number.POSITIVE_INFINITY;
    if (offset < current) {
      high = mid - 1;
    } else if (offset >= next) {
      low = mid + 1;
    } else {
      return mid;
    }
  }
  return Math.max(0, Math.min(lineOffsets.length - 1, low));
}

function largeTextLineOffsets(lines: string[]) {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}
