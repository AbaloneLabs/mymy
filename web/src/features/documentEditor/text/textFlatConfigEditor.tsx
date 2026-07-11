import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Plus,
  X,
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
  parseConfigInlineArray,
  parseConfigInlineObject,
  serializeConfigInlineArray,
  serializeConfigInlineObject,
} from "./textConfigValueUtils";
import {
  appendFlatConfigEntry,
  configEntryLineRange,
  configScalarType,
  deleteFlatConfigGroup,
  duplicateFlatConfigEntry,
  flatConfigEntryCanDuplicate,
  flatConfigEntryCanMove,
  joinStructuredTextLines,
  moveFlatConfigEntry,
  parseFlatConfig,
  splitStructuredTextLines,
} from "./textStructuredUtils";
import type { ConfigEntry } from "./textStructuredUtils";
import {
  flatConfigEntryEditBlockReason,
  flatConfigStructuralEditBlockReason,
  patchLosslessFlatConfigScalar,
} from "./textFlatConfigCapability";

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
  const structuralEditBlockReason = flatConfigStructuralEditBlockReason({
    ...parsed,
    content,
    kind,
  });
  const tree = useMemo(() => buildConfigTree(parsed.entries), [parsed.entries]);

  function updateLine(entry: ConfigEntry, key: string, value: string) {
    const next = patchLosslessFlatConfigScalar({
      content,
      entry,
      key,
      value,
      kind,
    });
    if (next !== null) onChangeContent(next);
  }

  function updateInlineArrayItem(
    entry: ConfigEntry,
    itemIndex: number,
    value: string,
  ) {
    const array = parseConfigInlineArray(entry.value);
    if (!array) return;
    const items = array.items.map((item, index) => (index === itemIndex ? value : item));
    updateLine(entry, entry.key, serializeConfigInlineArray(items, array.quote));
  }

  function addInlineArrayItem(entry: ConfigEntry) {
    const array = parseConfigInlineArray(entry.value);
    if (!array) return;
    updateLine(entry, entry.key, serializeConfigInlineArray([...array.items, ""], array.quote));
  }

  function deleteInlineArrayItem(entry: ConfigEntry, itemIndex: number) {
    const array = parseConfigInlineArray(entry.value);
    if (!array) return;
    updateLine(
      entry,
      entry.key,
      serializeConfigInlineArray(
        array.items.filter((_, index) => index !== itemIndex),
        array.quote,
      ),
    );
  }

  function updateInlineObjectEntry(
    entry: ConfigEntry,
    entryIndex: number,
    patch: Partial<{ key: string; value: string }>,
  ) {
    const object = parseConfigInlineObject(entry.value, kind);
    if (!object) return;
    updateLine(
      entry,
      entry.key,
      serializeConfigInlineObject({
        ...object,
        entries: object.entries.map((item, index) =>
          index === entryIndex ? { ...item, ...patch } : item,
        ),
      }),
    );
  }

  function addInlineObjectEntry(entry: ConfigEntry, key: string, value: string) {
    const object = parseConfigInlineObject(entry.value, kind);
    if (!object || !key.trim()) return;
    updateLine(
      entry,
      entry.key,
      serializeConfigInlineObject({
        ...object,
        entries: [...object.entries, { key, value }],
      }),
    );
  }

  function deleteInlineObjectEntry(entry: ConfigEntry, entryIndex: number) {
    const object = parseConfigInlineObject(entry.value, kind);
    if (!object) return;
    updateLine(
      entry,
      entry.key,
      serializeConfigInlineObject({
        ...object,
        entries: object.entries.filter((_, index) => index !== entryIndex),
      }),
    );
  }

  function deleteEntry(entry: ConfigEntry) {
    if (structuralEditBlockReason) return;
    const lines = splitStructuredTextLines(content);
    const range = configEntryLineRange(entry);
    lines.splice(range.start, range.end - range.start);
    onChangeContent(joinStructuredTextLines(lines, content));
  }

  function duplicateEntry(entry: ConfigEntry) {
    if (structuralEditBlockReason) return;
    onChangeContent(duplicateFlatConfigEntry(content, entry, kind));
  }

  function moveEntry(entry: ConfigEntry, direction: -1 | 1) {
    if (structuralEditBlockReason) return;
    onChangeContent(moveFlatConfigEntry(content, parsed.entries, entry, direction));
  }

  function addEntry() {
    if (structuralEditBlockReason) return;
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
    if (structuralEditBlockReason) return;
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
    const editBlockReason = flatConfigEntryEditBlockReason(entry, kind);
    return (
      <div
        key={`${entry.lineIndex}:${entry.key}`}
        className="grid gap-2 md:grid-cols-[minmax(110px,180px)_minmax(80px,100px)_minmax(0,1fr)_auto]"
        style={{ paddingLeft: depth * 16 }}
      >
        <input
          value={entry.key}
          onChange={(event) => updateLine(entry, event.target.value, entry.value)}
          disabled={!entry.keyEditable || Boolean(editBlockReason)}
          title={editBlockReason ?? undefined}
          className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-xs font-medium text-[var(--accent)] outline-none focus:border-[var(--accent)] disabled:text-[var(--text-faint)]"
        />
        <div className="min-w-0 space-y-1">
          <span
            className={cn(
              "block min-w-0 truncate rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs",
              jsonPreviewTypeClass(configScalarType(entry.value)),
            )}
          >
            {configScalarType(entry.value)}
          </span>
          <ConfigEntryMetadata entry={entry} documentCount={parsed.documentCount} />
        </div>
        <div className="grid min-w-0 gap-1">
          {entry.valueStyle ? (
            <textarea
              value={entry.value}
              onChange={(event) => updateLine(entry, entry.key, event.target.value)}
              disabled={Boolean(editBlockReason)}
              title={editBlockReason ?? undefined}
              rows={Math.min(8, Math.max(3, entry.value.split("\n").length))}
              className="min-w-0 resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          ) : (
            <input
              value={entry.value}
              onChange={(event) => updateLine(entry, entry.key, event.target.value)}
              disabled={Boolean(editBlockReason)}
              title={editBlockReason ?? undefined}
              className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          )}
          {editBlockReason ? (
            <span className="text-[10px] text-[var(--status-warning)]">
              {editBlockReason}
            </span>
          ) : (
            <>
              <InlineArrayEditor
                entry={entry}
                onAdd={() => addInlineArrayItem(entry)}
                onDelete={(itemIndex) => deleteInlineArrayItem(entry, itemIndex)}
                onUpdate={(itemIndex, value) =>
                  updateInlineArrayItem(entry, itemIndex, value)
                }
              />
              <InlineObjectEditor
                entry={entry}
                kind={kind}
                onAdd={(key, value) => addInlineObjectEntry(entry, key, value)}
                onDelete={(entryIndex) => deleteInlineObjectEntry(entry, entryIndex)}
                onUpdate={(entryIndex, patch) =>
                  updateInlineObjectEntry(entry, entryIndex, patch)
                }
              />
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <JsonIconButton
            disabled={
              Boolean(structuralEditBlockReason) ||
              !flatConfigEntryCanMove(parsed.entries, entry, -1)
            }
            icon={ArrowUp}
            label="Move entry up"
            onClick={() => moveEntry(entry, -1)}
          />
          <JsonIconButton
            disabled={
              Boolean(structuralEditBlockReason) ||
              !flatConfigEntryCanMove(parsed.entries, entry, 1)
            }
            icon={ArrowDown}
            label="Move entry down"
            onClick={() => moveEntry(entry, 1)}
          />
          <JsonIconButton
            disabled={
              Boolean(structuralEditBlockReason) ||
              !flatConfigEntryCanDuplicate(entry)
            }
            icon={Copy}
            label="Duplicate entry"
            onClick={() => duplicateEntry(entry)}
          />
          <JsonDeleteButton
            disabled={Boolean(structuralEditBlockReason)}
            onClick={() => deleteEntry(entry)}
          />
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
            disabled={Boolean(structuralEditBlockReason)}
            icon={Plus}
            label="Add child entry"
            onClick={() => prepareChildEntry(child.path)}
          />
          <JsonDeleteButton
            disabled={Boolean(structuralEditBlockReason)}
            onClick={() => deleteGroup(child.path)}
          />
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
          disabled={!canAddEntry || Boolean(structuralEditBlockReason)}
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
        {structuralEditBlockReason && (
          <span className="text-xs text-[var(--status-warning)]">
            Structural edits disabled: {structuralEditBlockReason}
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

function ConfigEntryMetadata({
  entry,
  documentCount,
}: {
  entry: ConfigEntry;
  documentCount: number;
}) {
  const items = [
    documentCount > 1 && entry.documentIndex !== undefined
      ? `doc ${entry.documentIndex + 1}`
      : null,
    ...(entry.yamlDecorators ?? []),
  ].filter((item): item is string => Boolean(item));
  if (items.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {items.map((item) => (
        <span
          key={item}
          className="max-w-full truncate rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-faint)]"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function InlineArrayEditor({
  entry,
  onAdd,
  onDelete,
  onUpdate,
}: {
  entry: ConfigEntry;
  onAdd: () => void;
  onDelete: (itemIndex: number) => void;
  onUpdate: (itemIndex: number, value: string) => void;
}) {
  const array = parseConfigInlineArray(entry.value);
  if (!array) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] p-1">
      {array.items.map((item, itemIndex) => (
        <span
          key={`${entry.lineIndex}:${itemIndex}`}
          className="inline-flex min-w-0 items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5"
        >
          <input
            value={item}
            onChange={(event) => onUpdate(itemIndex, event.target.value)}
            className="h-6 w-24 bg-transparent font-mono text-[11px] text-[var(--text)] outline-none"
          />
          <button
            type="button"
            onClick={() => onDelete(itemIndex)}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)]"
            title="Delete item"
          >
            <X className="h-3 w-3" strokeWidth={1.75} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex h-6 w-6 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        title="Add item"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

function InlineObjectEditor({
  entry,
  kind,
  onAdd,
  onDelete,
  onUpdate,
}: {
  entry: ConfigEntry;
  kind: "yaml" | "toml";
  onAdd: (key: string, value: string) => void;
  onDelete: (entryIndex: number) => void;
  onUpdate: (
    entryIndex: number,
    patch: Partial<{ key: string; value: string }>,
  ) => void;
}) {
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const object = parseConfigInlineObject(entry.value, kind);
  if (!object) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] p-1">
      {object.entries.map((item, itemIndex) => (
        <span
          key={`${entry.lineIndex}:object:${itemIndex}`}
          className="inline-flex min-w-0 items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5"
        >
          <input
            value={item.key}
            onChange={(event) => onUpdate(itemIndex, { key: event.target.value })}
            className="h-6 w-20 bg-transparent font-mono text-[11px] font-medium text-[var(--accent)] outline-none"
          />
          <span className="font-mono text-[10px] text-[var(--text-faint)]">
            {object.separator}
          </span>
          <input
            value={item.value}
            onChange={(event) => onUpdate(itemIndex, { value: event.target.value })}
            className="h-6 w-24 bg-transparent font-mono text-[11px] text-[var(--text)] outline-none"
          />
          <button
            type="button"
            onClick={() => onDelete(itemIndex)}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)]"
            title="Delete field"
          >
            <X className="h-3 w-3" strokeWidth={1.75} />
          </button>
        </span>
      ))}
      <span className="inline-flex min-w-0 items-center gap-1 rounded border border-dashed border-[var(--border)] bg-[var(--bg)] px-1 py-0.5">
        <input
          value={draftKey}
          onChange={(event) => setDraftKey(event.target.value)}
          placeholder="key"
          className="h-6 w-16 bg-transparent font-mono text-[11px] font-medium text-[var(--accent)] outline-none placeholder:text-[var(--text-faint)]"
        />
        <span className="font-mono text-[10px] text-[var(--text-faint)]">
          {object.separator}
        </span>
        <input
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          placeholder="value"
          className="h-6 w-20 bg-transparent font-mono text-[11px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
        />
      </span>
      <button
        type="button"
        onClick={() => {
          onAdd(draftKey, draftValue);
          setDraftKey("");
          setDraftValue("");
        }}
        disabled={!draftKey.trim()}
        className="inline-flex h-6 w-6 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        title="Add field"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
