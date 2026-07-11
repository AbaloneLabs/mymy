import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  Braces,
  Copy,
  FileCog,
  IndentDecrease,
  IndentIncrease,
  ListTree,
  MessageSquare,
  Pilcrow,
  Rows3,
  Search,
  Table,
  WrapText,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { lineEndingLabel } from "./textSourceUtils";
import type { TextEditorMode } from "./textSourceTypes";
import {
  modeButtonClass,
  toolbarIconButtonClass,
  toolbarTextButtonClass,
} from "./textEditorChromeClasses";

type TextEditorToolbarProps = {
  activeMode: TextEditorMode;
  blockCommentsAvailable: boolean;
  bom?: boolean;
  encoding?: string;
  goToLineOpen: boolean;
  json: boolean;
  largeTextMode: boolean;
  language: string;
  lineEnding?: string;
  outlineOpen: boolean;
  schemaOpen: boolean;
  searchOpen: boolean;
  structured: boolean;
  tableAvailable: boolean;
  onDuplicateSelection: () => void;
  onEnsureFinalNewline: () => void;
  onFormatJson: () => void;
  onIndentSelection: () => void;
  onOpenFileFormat: () => void;
  onMinifyJson: () => void;
  onMoveSelection: (direction: -1 | 1) => void;
  onOutdentSelection: () => void;
  onSetMode: (mode: TextEditorMode) => void;
  onSortJsonKeys: () => void;
  onToggleBlockComment: () => void;
  onToggleGoToLine: () => void;
  onToggleLineComment: () => void;
  onToggleOutline: () => void;
  onTogglePreview: () => void;
  onToggleSchema: () => void;
  onToggleSearch: () => void;
  onTrimTrailingWhitespace: () => void;
};

export function TextEditorToolbar({
  activeMode,
  blockCommentsAvailable,
  bom,
  encoding,
  goToLineOpen,
  json,
  largeTextMode,
  language,
  lineEnding,
  outlineOpen,
  schemaOpen,
  searchOpen,
  structured,
  tableAvailable,
  onDuplicateSelection,
  onEnsureFinalNewline,
  onFormatJson,
  onIndentSelection,
  onOpenFileFormat,
  onMinifyJson,
  onMoveSelection,
  onOutdentSelection,
  onSetMode,
  onSortJsonKeys,
  onToggleBlockComment,
  onToggleGoToLine,
  onToggleLineComment,
  onToggleOutline,
  onTogglePreview,
  onToggleSchema,
  onToggleSearch,
  onTrimTrailingWhitespace,
}: TextEditorToolbarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <span className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono text-xs text-[var(--text-muted)]">
          {language}
        </span>
        <button
          type="button"
          onClick={onToggleSearch}
          className={toolbarTextButtonClass(searchOpen)}
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("documentEditor.find", { defaultValue: "Find" })}
        </button>
        <button
          type="button"
          onClick={onToggleGoToLine}
          className={toolbarTextButtonClass(goToLineOpen)}
        >
          L:
          {t("documentEditor.goToLine", { defaultValue: "Go to line" })}
        </button>
        {!largeTextMode && (
          <>
            <button type="button" onClick={onIndentSelection} className={toolbarIconButtonClass()}>
              <IndentIncrease className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <button type="button" onClick={onOutdentSelection} className={toolbarIconButtonClass()}>
              <IndentDecrease className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <button type="button" onClick={onToggleLineComment} className={toolbarIconButtonClass()}>
              <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            {blockCommentsAvailable && (
              <button
                type="button"
                onClick={onToggleBlockComment}
                className={toolbarTextButtonClass(false)}
                title="Toggle block comment"
              >
                /* */
              </button>
            )}
            <button type="button" onClick={onDuplicateSelection} className={toolbarIconButtonClass()}>
              <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <button type="button" onClick={() => onMoveSelection(-1)} className={toolbarIconButtonClass()}>
              <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <button type="button" onClick={() => onMoveSelection(1)} className={toolbarIconButtonClass()}>
              <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <button type="button" onClick={onTrimTrailingWhitespace} className={toolbarIconButtonClass()}>
              <WrapText className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <button type="button" onClick={onEnsureFinalNewline} className={toolbarIconButtonClass()}>
              <Pilcrow className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={onToggleOutline}
              className={toolbarTextButtonClass(outlineOpen)}
            >
              <ListTree className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t("documentEditor.outline", { defaultValue: "Outline" })}
            </button>
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          disabled={largeTextMode}
          onClick={onOpenFileFormat}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono text-xs text-[var(--text-faint)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          title={
            largeTextMode
              ? "File format conversion is disabled in large-file mode"
              : "Preview and apply encoding, BOM, and line-ending changes"
          }
        >
          {encoding ?? "utf-8"} · {lineEndingLabel(lineEnding)} ·{" "}
          {bom ? "BOM" : "no BOM"}
        </button>
        {!largeTextMode && (
          <>
            {json && (
              <>
                <button
                  type="button"
                  onClick={onFormatJson}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                >
                  <Braces className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {t("documentEditor.format", { defaultValue: "Format" })}
                </button>
                <button
                  type="button"
                  onClick={onMinifyJson}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                >
                  <Rows3 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Minify
                </button>
                <button
                  type="button"
                  onClick={onSortJsonKeys}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                >
                  <ArrowDownAZ className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Sort keys
                </button>
                <button
                  type="button"
                  onClick={onToggleSchema}
                  className={toolbarTextButtonClass(schemaOpen)}
                >
                  <FileCog className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Schema
                </button>
              </>
            )}
          </>
        )}
        <button
          type="button"
          onClick={() => onSetMode("source")}
          className={modeButtonClass(activeMode === "source")}
        >
          {t("documentEditor.source", { defaultValue: "Source" })}
        </button>
        {!largeTextMode && structured && (
          <button
            type="button"
            onClick={() => onSetMode("tree")}
            className={modeButtonClass(activeMode === "tree")}
          >
            {t("documentEditor.tree", { defaultValue: "Tree" })}
          </button>
        )}
        {!largeTextMode && json && (
          <button
            type="button"
            onClick={() => onSetMode("table")}
            disabled={!tableAvailable}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Table className="h-3.5 w-3.5" strokeWidth={1.75} />
            Table
          </button>
        )}
        {!largeTextMode && (
          <button
            type="button"
            onClick={onTogglePreview}
            className={modeButtonClass(activeMode === "preview")}
          >
            {activeMode === "preview"
              ? t("documentEditor.source", { defaultValue: "Source" })
              : t("documentEditor.preview")}
          </button>
        )}
      </div>
    </div>
  );
}
