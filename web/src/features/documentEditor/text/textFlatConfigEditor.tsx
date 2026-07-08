import { useMemo, useState } from "react";
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
import { jsonPreviewTypeClass } from "./textJsonUtils";
import {
  buildConfigTree,
  configTreePathKey,
  type ConfigTreeNode,
} from "./textConfigTree";
import {
  appendFlatConfigEntry,
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
