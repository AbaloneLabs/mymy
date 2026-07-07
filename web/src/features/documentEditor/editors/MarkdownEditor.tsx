import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Bold,
  Check,
  Code,
  FileCog,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTree,
  Loader2,
  Plus,
  ListTodo,
  Quote,
  Search,
  Strikethrough,
  Table,
  Trash2,
  Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { driveBlobUrl, uploadDriveFiles } from "@/features/drive/api";
import { parentPath } from "@/features/drive/utils";
import { HighlightedCodeBlock } from "@/components/chat/codeHighlight";
import type { EditorCommandRequest } from "../commands";
import {
  buildMarkdownSearchRegex,
  countMarkdownSearchMatches,
  formatFrontmatterField,
  hasTrailingTextNewline,
  indentMarkdownLine,
  insertFootnoteReference,
  isMarkdownHeadingKey,
  isMarkdownUrl,
  lineForOffset,
  markdownOutline,
  markdownReferences,
  markdownStats,
  nextMarkdownFootnoteId,
  nextMarkdownSearchRange,
  offsetForLine,
  outdentMarkdownLine,
  parseFrontmatter,
  parseFrontmatterFields,
  replaceFrontmatterBody,
} from "../markdownEditorUtils";
import type { MarkdownHeadingLevel } from "../markdownEditorUtils";
import type { TextModel } from "../models";
import { ToolbarButton } from "../shared";

export function MarkdownRichEditor({
  filePath,
  model,
  onChange,
  commandRequest,
  onCommandHandled,
}: {
  filePath: string;
  model: TextModel;
  onChange: (model: TextModel) => void;
  commandRequest?: EditorCommandRequest | null;
  onCommandHandled?: (request: EditorCommandRequest) => void;
}) {
  const { t } = useTranslation();
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const lineNumberRef = useRef<HTMLPreElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const handledCommandTokenRef = useRef<number | null>(null);
  const [mode, setMode] = useState<"source" | "preview">("source");
  const [sidePanel, setSidePanel] =
    useState<"outline" | "frontmatter" | "references" | null>(null);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [imageDraft, setImageDraft] = useState("");
  const [imageAltDraft, setImageAltDraft] = useState("");
  const [imageInputOpen, setImageInputOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [newFrontmatterKey, setNewFrontmatterKey] = useState("");
  const [newFrontmatterValue, setNewFrontmatterValue] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [replaceDraft, setReplaceDraft] = useState("");
  const [goToLineOpen, setGoToLineOpen] = useState(false);
  const [goToLineDraft, setGoToLineDraft] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexSearch, setRegexSearch] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, column: 1, selection: 0 });
  const lineCount = Math.max(1, model.content.split("\n").length);
  const outline = markdownOutline(model.content);
  const references = markdownReferences(model.content);
  const frontmatter = parseFrontmatter(model.content);
  const frontmatterFields = frontmatter
    ? parseFrontmatterFields(frontmatter.content, frontmatter.marker)
    : [];
  const stats = markdownStats(model.content, outline.length);
  const searchMatches = countMarkdownSearchMatches(model.content, searchDraft, {
    matchCase,
    wholeWord,
    regexSearch,
  });
  const previewComponents = useMemo(
    () => markdownPreviewComponents(filePath),
    [filePath],
  );

  function updateContent(content: string) {
    onChange({ ...model, content, trailingNewline: hasTrailingTextNewline(content) });
  }

  function submitLink() {
    const url = linkDraft.trim();
    if (!url) return;
    insertSourceLink(url);
    setLinkInputOpen(false);
    setLinkDraft("");
  }

  function submitImage() {
    const src = imageDraft.trim();
    if (!src) return;
    insertImageReference(src, imageAltDraft.trim());
  }

  function insertImageReference(src: string, altText: string) {
    insertSourceInline(`![${altText}](${src})`);
    setImageInputOpen(false);
    setImageDraft("");
    setImageAltDraft("");
    setImageUploadError(null);
  }

  async function uploadAndInsertImage(file: File) {
    if (!file.type.startsWith("image/")) return;
    setUploadingImage(true);
    setImageUploadError(null);
    try {
      const uploaded = await uploadDriveFiles(parentPath(filePath), [file]);
      const entry = uploaded.files[0];
      if (!entry) return;
      insertImageReference(
        markdownRelativeFileReference(filePath, entry.path, entry.name),
        imageAltDraft.trim() || file.name.replace(/\.[^.]+$/, ""),
      );
    } catch (error) {
      setImageUploadError(error instanceof Error ? error.message : "Image upload failed");
    } finally {
      setUploadingImage(false);
    }
  }

  function insertTaskList() {
    transformSelectedSourceLines((line) =>
      /^\s*-\s+\[[ xX]\]\s+/.test(line)
        ? line
        : line.replace(/^(\s*)/, "$1- [ ] "),
    );
  }

  function applyBlockquote() {
    transformSelectedSourceLines((line) =>
      /^\s*>\s?/.test(line) ? line : line.replace(/^(\s*)/, "$1> "),
    );
  }

  function applyInlineCode() {
    wrapSourceSelection("`");
  }

  function insertCodeBlock() {
    insertSourceSnippet("```\ncode\n```\n", 4, 8);
  }

  function insertMarkdownTable() {
    insertSourceSnippet("| Header 1 | Header 2 |\n| --- | --- |\n|  |  |\n", 2, 10);
  }

  function insertFootnote() {
    const id = nextMarkdownFootnoteId(model.content);
    const textarea = sourceRef.current;
    if (mode === "source" && textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const next = insertFootnoteReference(model.content, id, start, end);
      updateContent(next.content);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(next.selectionStart, next.selectionEnd);
        syncLineNumberScroll();
      });
      return;
    }
    setMode("source");
  }

  function insertSourceSnippet(
    snippet: string,
    selectStartOffset = snippet.length,
    selectEndOffset = selectStartOffset,
  ) {
    const textarea = sourceRef.current;
    if (!textarea) {
      setMode("source");
      const prefix = model.content.length > 0 && !model.content.endsWith("\n") ? "\n" : "";
      updateContent(`${model.content}${prefix}${snippet}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = model.content.slice(0, start);
    const after = model.content.slice(end);
    const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    const suffix = after.length > 0 && !snippet.endsWith("\n") ? "\n" : "";
    const inserted = `${prefix}${snippet}${suffix}`;
    const next = `${before}${inserted}${after}`;
    updateContent(next);
    const selectionStart = start + prefix.length + selectStartOffset;
    const selectionEnd = start + prefix.length + selectEndOffset;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
      syncLineNumberScroll();
    });
  }

  function insertSourceInline(text: string) {
    const textarea = sourceRef.current;
    if (!textarea) {
      setMode("source");
      const prefix = model.content.length > 0 && !model.content.endsWith("\n") ? "\n" : "";
      updateContent(`${model.content}${prefix}${text}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${model.content.slice(0, start)}${text}${model.content.slice(end)}`;
    updateContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + text.length, start + text.length);
      syncLineNumberScroll();
    });
  }

  function insertSourceLink(url: string) {
    const textarea = sourceRef.current;
    if (!textarea) {
      setMode("source");
      const prefix = model.content.length > 0 && !model.content.endsWith("\n") ? "\n" : "";
      updateContent(`${model.content}${prefix}[${url}](${url})`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = model.content.slice(start, end);
    const label = selected || url;
    const link = `[${label}](${url})`;
    const next = `${model.content.slice(0, start)}${link}${model.content.slice(end)}`;
    updateContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + 1, start + 1 + label.length);
      syncLineNumberScroll();
    });
  }

  function handleSourceKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const primary = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (event.key === "Tab") {
      event.preventDefault();
      transformSelectedSourceLines(event.shiftKey ? outdentMarkdownLine : indentMarkdownLine);
    } else if (primary && key === "b") {
      event.preventDefault();
      wrapSourceSelection("**");
    } else if (primary && key === "f") {
      event.preventDefault();
      setSearchOpen(true);
    } else if (primary && key === "h") {
      event.preventDefault();
      setSearchOpen(true);
    } else if (primary && key === "g") {
      event.preventDefault();
      setGoToLineDraft(String(cursor.line));
      setGoToLineOpen(true);
    } else if (primary && event.shiftKey && key === "i") {
      event.preventDefault();
      setImageInputOpen(true);
    } else if (primary && key === "i") {
      event.preventDefault();
      wrapSourceSelection("*");
    } else if (primary && key === "k") {
      event.preventDefault();
      wrapSourceSelection("[", "](url)");
    } else if (primary && event.shiftKey && key === "9") {
      event.preventDefault();
      insertTaskList();
    } else if (primary && event.shiftKey && (key === "." || key === ">")) {
      event.preventDefault();
      applyBlockquote();
    } else if (primary && key === "e") {
      event.preventDefault();
      applyInlineCode();
    } else if (primary && event.altKey && key === "c") {
      event.preventDefault();
      insertCodeBlock();
    } else if (primary && event.altKey && key === "t") {
      event.preventDefault();
      insertMarkdownTable();
    } else if (primary && event.altKey && key === "o") {
      event.preventDefault();
      setSidePanel((current) => (current === "outline" ? null : "outline"));
    } else if (primary && event.shiftKey && key === "v") {
      event.preventDefault();
      setMode((current) => (current === "preview" ? "source" : "preview"));
    } else if (primary && event.altKey && isMarkdownHeadingKey(key)) {
      event.preventDefault();
      applySourceHeading(Number(key) as MarkdownHeadingLevel);
    }
  }

  function handleSourcePaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const textarea = sourceRef.current;
    if (!textarea || textarea.selectionStart === textarea.selectionEnd) return;
    const pasted = event.clipboardData.getData("text/plain").trim();
    if (!isMarkdownUrl(pasted)) return;
    event.preventDefault();
    const selected = model.content.slice(textarea.selectionStart, textarea.selectionEnd);
    const next = `${model.content.slice(0, textarea.selectionStart)}[${selected}](${pasted})${model.content.slice(textarea.selectionEnd)}`;
    const start = textarea.selectionStart;
    updateContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + selected.length + pasted.length + 4);
    });
  }

  function syncLineNumberScroll() {
    if (!sourceRef.current || !lineNumberRef.current) return;
    lineNumberRef.current.scrollTop = sourceRef.current.scrollTop;
  }

  function updateCursor() {
    const textarea = sourceRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const line = lineForOffset(model.content, start);
    setCursor({
      line,
      column: start - offsetForLine(model.content, line) + 1,
      selection: Math.abs(end - start),
    });
  }

  function wrapSourceSelection(before: string, after = before) {
    const textarea = sourceRef.current;
    if (!textarea) {
      setMode("source");
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${model.content.slice(0, start)}${before}${model.content.slice(start, end)}${after}${model.content.slice(end)}`;
    updateContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, end + before.length);
    });
  }

  function applyHeading(level: MarkdownHeadingLevel) {
    applySourceHeading(level);
  }

  function applySourceHeading(level: MarkdownHeadingLevel) {
    const textarea = sourceRef.current;
    if (!textarea) {
      setMode("source");
      return;
    }
    const start = textarea.selectionStart;
    const lineStart = model.content.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEnd = model.content.indexOf("\n", start);
    const end = lineEnd === -1 ? model.content.length : lineEnd;
    const line = model.content.slice(lineStart, end);
    const prefix = `${"#".repeat(level)} `;
    const nextLine = line.replace(/^#{1,6}\s+/, "");
    const next = `${model.content.slice(0, lineStart)}${prefix}${nextLine}${model.content.slice(end)}`;
    updateContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(lineStart + prefix.length, lineStart + prefix.length + nextLine.length);
      updateCursor();
    });
  }

  function transformSelectedSourceLines(transform: (line: string) => string) {
    const textarea = sourceRef.current;
    if (!textarea) {
      setMode("source");
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = model.content.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const nextNewline = model.content.indexOf("\n", end);
    const lineEnd = nextNewline === -1 ? model.content.length : nextNewline;
    const block = model.content.slice(lineStart, lineEnd);
    const nextBlock = block.split("\n").map(transform).join("\n");
    const next = `${model.content.slice(0, lineStart)}${nextBlock}${model.content.slice(lineEnd)}`;
    updateContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(lineStart, lineStart + nextBlock.length);
      updateCursor();
    });
  }

  function focusSourceLine(line: number) {
    focusSourceRange(offsetForLine(model.content, line), offsetForLine(model.content, line));
  }

  function focusSourceRange(start: number, end: number) {
    setMode("source");
    requestAnimationFrame(() => {
      const textarea = sourceRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(start, end);
      const line = lineForOffset(model.content, start);
      textarea.scrollTop = Math.max(0, (line - 4) * 24);
      syncLineNumberScroll();
      updateCursor();
    });
  }

  function submitGoToLine() {
    const line = Math.max(1, Math.min(lineCount, Math.floor(Number(goToLineDraft))));
    if (!Number.isFinite(line)) return;
    focusSourceLine(line);
    setGoToLineOpen(false);
  }

  function findNext() {
    const start = sourceRef.current?.selectionEnd ?? 0;
    const range = nextMarkdownSearchRange(model.content, searchDraft, {
      matchCase,
      wholeWord,
      regexSearch,
      start,
    });
    if (range) focusSourceRange(range.start, range.end);
  }

  function replaceNext() {
    const textarea = sourceRef.current;
    const regex = buildMarkdownSearchRegex(searchDraft, {
      matchCase,
      wholeWord,
      regexSearch,
    });
    if (!regex) return;
    if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
      const selected = model.content.slice(textarea.selectionStart, textarea.selectionEnd);
      regex.lastIndex = 0;
      const match = regex.exec(selected);
      if (match && match.index === 0 && match[0].length === selected.length) {
        const next = `${model.content.slice(0, textarea.selectionStart)}${selected.replace(regex, replaceDraft)}${model.content.slice(textarea.selectionEnd)}`;
        const caret = textarea.selectionStart + replaceDraft.length;
        updateContent(next);
        requestAnimationFrame(() => focusSourceRange(caret, caret));
        return;
      }
    }
    findNext();
  }

  function replaceAll() {
    const regex = buildMarkdownSearchRegex(searchDraft, {
      matchCase,
      wholeWord,
      regexSearch,
    });
    if (!regex) return;
    updateContent(model.content.replace(regex, replaceDraft));
  }

  function openFrontmatterPanel() {
    if (!frontmatter) {
      const prefix = model.content.length > 0 ? "\n\n" : "";
      updateContent(`---\n---\n${prefix}${model.content}`);
    }
    setSidePanel("frontmatter");
    setMode("source");
  }

  function updateFrontmatterBody(body: string) {
    const next = replaceFrontmatterBody(model.content, body);
    if (next) updateContent(next);
  }

  function updateFrontmatterField(lineIndex: number, key: string, value: string) {
    if (!frontmatter) return;
    const lines = frontmatter.content.split(/\r?\n/);
    const cleanKey = key.trim();
    if (!cleanKey) return;
    lines[lineIndex] = formatFrontmatterField(cleanKey, value, frontmatter.marker);
    updateFrontmatterBody(lines.join("\n"));
  }

  function deleteFrontmatterField(lineIndex: number) {
    if (!frontmatter) return;
    const lines = frontmatter.content.split(/\r?\n/);
    lines.splice(lineIndex, 1);
    updateFrontmatterBody(lines.join("\n"));
  }

  function addFrontmatterField() {
    if (!frontmatter) return;
    const cleanKey = newFrontmatterKey.trim();
    if (!cleanKey) return;
    const lines = frontmatter.content.split(/\r?\n/).filter((line) => line.length > 0);
    lines.push(formatFrontmatterField(cleanKey, newFrontmatterValue, frontmatter.marker));
    updateFrontmatterBody(lines.join("\n"));
    setNewFrontmatterKey("");
    setNewFrontmatterValue("");
  }

  function removeFrontmatter() {
    if (!frontmatter) return;
    updateContent(`${model.content.slice(0, frontmatter.start)}${model.content.slice(frontmatter.end)}`.replace(/^\s*\n/, ""));
  }

  const handleCommandRequest = useEffectEvent(
    (commandId: EditorCommandRequest["id"]) => {
    if (commandId === "bold") {
      wrapSourceSelection("**");
    } else if (commandId === "italic") {
      wrapSourceSelection("*");
    } else if (commandId === "strikethrough") {
      wrapSourceSelection("~~");
    } else if (commandId === "link") {
      setLinkInputOpen(true);
    } else if (commandId === "heading1") {
      applyHeading(1);
    } else if (commandId === "heading2") {
      applyHeading(2);
    } else if (commandId === "heading3") {
      applyHeading(3);
    } else if (commandId === "heading4") {
      applyHeading(4);
    } else if (commandId === "heading5") {
      applyHeading(5);
    } else if (commandId === "heading6") {
      applyHeading(6);
    } else if (commandId === "togglePreview") {
      setMode((current) => (current === "preview" ? "source" : "preview"));
    } else if (commandId === "bulletList") {
      transformSelectedSourceLines((line) =>
        /^\s*(?:[-*+]|\d+\.)\s+/.test(line)
          ? line
          : line.replace(/^(\s*)/, "$1- "),
      );
    } else if (commandId === "numberedList") {
      transformSelectedSourceLines((line) =>
        /^\s*(?:[-*+]|\d+\.)\s+/.test(line)
          ? line
          : line.replace(/^(\s*)/, (_match, indent: string) => `${indent}1. `),
      );
    } else if (commandId === "taskList") {
      insertTaskList();
    } else if (commandId === "blockquote") {
      applyBlockquote();
    } else if (commandId === "inlineCode") {
      applyInlineCode();
    } else if (commandId === "codeBlock") {
      insertCodeBlock();
    } else if (commandId === "image") {
      setImageInputOpen(true);
    } else if (commandId === "insertTable") {
      insertMarkdownTable();
    } else if (commandId === "outline") {
      setSidePanel((current) => (current === "outline" ? null : "outline"));
    } else if (commandId === "goToLine") {
      setGoToLineDraft(String(cursor.line));
      setGoToLineOpen(true);
    } else {
      return false;
    }
    return true;
    },
  );

  function togglePreview() {
    setMode((current) => (current === "preview" ? "source" : "preview"));
  }

  useEffect(() => {
    if (!commandRequest || handledCommandTokenRef.current === commandRequest.token) return;
    handledCommandTokenRef.current = commandRequest.token;
    window.setTimeout(() => {
      if (handleCommandRequest(commandRequest.id)) {
        onCommandHandled?.(commandRequest);
      }
    }, 0);
  }, [commandRequest, onCommandHandled]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--border)] px-3 py-2">
        <ToolbarButton icon={Heading1} label="H1" onClick={() => applyHeading(1)} />
        <ToolbarButton icon={Heading2} label="H2" onClick={() => applyHeading(2)} />
        <ToolbarButton icon={Heading3} label="H3" onClick={() => applyHeading(3)} />
        <ToolbarButton icon={Heading4} label="H4" onClick={() => applyHeading(4)} />
        <ToolbarButton icon={Heading5} label="H5" onClick={() => applyHeading(5)} />
        <ToolbarButton icon={Heading6} label="H6" onClick={() => applyHeading(6)} />
        <ToolbarButton icon={Bold} label={t("documentEditor.bold")} onClick={() => wrapSourceSelection("**")} />
        <ToolbarButton icon={Italic} label={t("documentEditor.italic")} onClick={() => wrapSourceSelection("*")} />
        <ToolbarButton icon={Strikethrough} label="Strike" onClick={() => wrapSourceSelection("~~")} />
        <ToolbarButton
          icon={List}
          label={t("documentEditor.bullets")}
          onClick={() =>
            transformSelectedSourceLines((line) =>
              /^\s*(?:[-*+]|\d+\.)\s+/.test(line)
                ? line
                : line.replace(/^(\s*)/, "$1- "),
            )
          }
        />
        <ToolbarButton
          icon={ListOrdered}
          label={t("documentEditor.numbered")}
          onClick={() =>
            transformSelectedSourceLines((line) =>
              /^\s*(?:[-*+]|\d+\.)\s+/.test(line)
                ? line
                : line.replace(/^(\s*)/, (_match, indent: string) => `${indent}1. `),
            )
          }
        />
        <ToolbarButton icon={ListTodo} label="Task list" onClick={insertTaskList} />
        <ToolbarButton icon={Quote} label={t("documentEditor.quote")} onClick={applyBlockquote} />
        <ToolbarButton icon={Code} label={t("documentEditor.code")} onClick={applyInlineCode} />
        <ToolbarButton
          icon={Link}
          label={t("documentEditor.link")}
          onClick={() => {
            setLinkInputOpen((current) => !current);
          }}
        />
        <ToolbarButton
          icon={Image}
          label="Image"
          onClick={() => {
            setImageInputOpen((current) => !current);
          }}
        />
        <ToolbarButton
          icon={Table}
          label={t("documentEditor.table")}
          onClick={insertMarkdownTable}
        />
        <ToolbarButton
          icon={Plus}
          label={t("documentEditor.footnote", { defaultValue: "Footnote" })}
          onClick={insertFootnote}
        />
        <ToolbarButton
          icon={ListTree}
          label={t("documentEditor.outline", { defaultValue: "Outline" })}
          active={sidePanel === "outline"}
          onClick={() => setSidePanel((current) => (current === "outline" ? null : "outline"))}
        />
        <ToolbarButton
          icon={FileCog}
          label={t("documentEditor.frontmatter", { defaultValue: "Frontmatter" })}
          active={sidePanel === "frontmatter"}
          onClick={openFrontmatterPanel}
        />
        <ToolbarButton
          icon={Link}
          label={t("documentEditor.references", { defaultValue: "References" })}
          active={sidePanel === "references"}
          onClick={() =>
            setSidePanel((current) => (current === "references" ? null : "references"))
          }
        />
        <ToolbarButton
          icon={Search}
          label={t("documentEditor.find", { defaultValue: "Find" })}
          active={searchOpen}
          onClick={() => {
            setSearchOpen((current) => !current);
            setMode("source");
          }}
        />
        <button
          type="button"
          onClick={() => {
            setGoToLineDraft(String(cursor.line));
            setGoToLineOpen((current) => !current);
            setMode("source");
          }}
          className={markdownTextButtonClass()}
        >
          L:
          {t("documentEditor.goToLine", { defaultValue: "Go to line" })}
        </button>
        <button
          type="button"
          onClick={togglePreview}
          className={modeButtonClass(mode === "preview")}
        >
          {mode === "preview"
            ? t("documentEditor.source", { defaultValue: "Source" })
            : t("documentEditor.preview")}
        </button>
        {linkInputOpen && (
          <form
            className="flex min-w-48 items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              submitLink();
            }}
          >
            <input
              value={linkDraft}
              onChange={(event) => setLinkDraft(event.target.value)}
              placeholder={t("documentEditor.linkUrl")}
              className="h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
              title={t("documentEditor.applyLink")}
            >
              <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </form>
        )}
        {imageInputOpen && (
          <form
            className="flex min-w-72 items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              submitImage();
            }}
          >
            <input
              value={imageDraft}
              onChange={(event) => setImageDraft(event.target.value)}
              placeholder="Image path or URL"
              className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <input
              value={imageAltDraft}
              onChange={(event) => setImageAltDraft(event.target.value)}
              placeholder="Alt"
              className="h-8 w-24 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
            <button
              type="button"
              onClick={() => imageFileInputRef.current?.click()}
              disabled={uploadingImage}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              title="Upload image"
            >
              {uploadingImage ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
              ) : (
                <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
            </button>
            <input
              ref={imageFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void uploadAndInsertImage(file);
                event.currentTarget.value = "";
              }}
            />
            <button
              type="submit"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
              title="Insert image"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            {imageUploadError && (
              <span className="max-w-48 truncate text-[11px] text-[var(--status-error)]">
                {imageUploadError}
              </span>
            )}
          </form>
        )}
      </div>
      {searchOpen && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder={t("documentEditor.find", { defaultValue: "Find" })}
            className="h-8 min-w-48 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <input
            value={replaceDraft}
            onChange={(event) => setReplaceDraft(event.target.value)}
            placeholder={t("documentEditor.replace", { defaultValue: "Replace" })}
            className="h-8 min-w-48 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <button type="button" onClick={findNext} className={markdownTextButtonClass()}>
            Next
          </button>
          <button type="button" onClick={replaceNext} className={markdownTextButtonClass()}>
            Replace
          </button>
          <button type="button" onClick={replaceAll} className={markdownTextButtonClass()}>
            All
          </button>
          <label className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={matchCase}
              onChange={(event) => setMatchCase(event.target.checked)}
            />
            Aa
          </label>
          <label className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={wholeWord}
              onChange={(event) => setWholeWord(event.target.checked)}
            />
            Word
          </label>
          <label className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={regexSearch}
              onChange={(event) => setRegexSearch(event.target.checked)}
            />
            .*
          </label>
          <span className="text-xs text-[var(--text-faint)]">
            {searchMatches} matches
          </span>
        </div>
      )}
      {goToLineOpen && (
        <form
          className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitGoToLine();
          }}
        >
          <span className="text-xs text-[var(--text-muted)]">
            {t("documentEditor.goToLine", { defaultValue: "Go to line" })}
          </span>
          <input
            value={goToLineDraft}
            onChange={(event) => setGoToLineDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setGoToLineOpen(false);
              }
            }}
            type="number"
            min={1}
            max={lineCount}
            className="h-8 w-28 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            autoFocus
          />
          <span className="text-xs text-[var(--text-faint)]">/ {lineCount}</span>
          <button type="submit" className={markdownTextButtonClass()}>
            Go
          </button>
        </form>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1">
          {mode === "preview" ? (
            <article className="chat-markdown h-full min-h-0 overflow-y-auto p-5 text-sm">
              <ReactMarkdown
                components={previewComponents}
                remarkPlugins={[remarkGfm]}
              >
                {model.content}
              </ReactMarkdown>
            </article>
          ) : (
            <div className="grid h-full min-h-0 grid-cols-[auto_minmax(0,1fr)] overflow-hidden bg-[var(--bg)]">
              <pre
                ref={lineNumberRef}
                className="select-none overflow-hidden border-r border-[var(--border)] bg-[var(--surface)] px-3 py-4 text-right font-mono text-xs leading-6 text-[var(--text-faint)]"
              >
                {Array.from({ length: lineCount }, (_, index) => index + 1).join("\n")}
              </pre>
              <textarea
                ref={sourceRef}
                value={model.content}
                onChange={(event) => updateContent(event.target.value)}
                onKeyDown={handleSourceKeyDown}
                onPaste={handleSourcePaste}
                onSelect={updateCursor}
                onKeyUp={updateCursor}
                onClick={updateCursor}
                onScroll={syncLineNumberScroll}
                spellCheck={false}
                className="min-h-0 resize-none bg-[var(--bg)] p-4 font-mono text-sm leading-6 text-[var(--text)] outline-none"
              />
            </div>
          )}
        </div>
        {sidePanel && (
          <aside className="flex w-80 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border)] px-3">
              <span className="text-xs font-semibold text-[var(--text)]">
                {sidePanel === "outline"
                  ? t("documentEditor.outline", { defaultValue: "Outline" })
                  : sidePanel === "references"
                    ? t("documentEditor.references", { defaultValue: "References" })
                    : t("documentEditor.frontmatter", { defaultValue: "Frontmatter" })}
              </span>
              <button
                type="button"
                onClick={() => setSidePanel(null)}
                className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              >
                {t("common.close")}
              </button>
            </div>
            {sidePanel === "outline" ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {outline.length === 0 ? (
                  <p className="text-xs text-[var(--text-faint)]">
                    {t("documentEditor.noOutline", { defaultValue: "No headings yet." })}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {outline.map((heading) => (
                      <button
                        key={`${heading.line}:${heading.text}`}
                        type="button"
                        onClick={() => focusSourceLine(heading.line)}
                        className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                        style={{ paddingLeft: `${Math.max(0, heading.level - 1) * 12 + 8}px` }}
                      >
                        {heading.text}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : sidePanel === "references" ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {references.length === 0 ? (
                  <p className="text-xs text-[var(--text-faint)]">
                    {t("documentEditor.noReferences", {
                      defaultValue: "No links, images, footnotes, or definitions yet.",
                    })}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {references.map((reference) => (
                      <button
                        key={`${reference.kind}:${reference.line}:${reference.start}:${reference.label}`}
                        type="button"
                        onClick={() => focusSourceRange(reference.start, reference.end)}
                        className="block w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-left hover:bg-[var(--surface-hover)]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium text-[var(--text)]">
                            {reference.label}
                          </span>
                          <span className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--text-faint)]">
                            {reference.kind}
                          </span>
                        </div>
                        {reference.target && (
                          <div className="mt-1 truncate font-mono text-[11px] text-[var(--text-faint)]">
                            {reference.target}
                          </div>
                        )}
                        <div className="mt-1 text-[10px] text-[var(--text-faint)]">
                          L{reference.line}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {frontmatter ? (
                  <div className="space-y-3">
                    <textarea
                      value={frontmatter.content}
                      onChange={(event) => updateFrontmatterBody(event.target.value)}
                      spellCheck={false}
                      className="h-40 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-xs leading-5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                    />
                    {frontmatterFields.length > 0 && (
                      <div className="space-y-2">
                        {frontmatterFields.map((field) => (
                          <div
                            key={`${field.lineIndex}:${field.key}`}
                            className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_auto] gap-1"
                          >
                            <input
                              value={field.key}
                              onChange={(event) =>
                                updateFrontmatterField(field.lineIndex, event.target.value, field.value)
                              }
                              className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                            />
                            <input
                              value={field.value}
                              onChange={(event) =>
                                updateFrontmatterField(field.lineIndex, field.key, event.target.value)
                              }
                              className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                            />
                            <ToolbarButton
                              icon={Trash2}
                              label={t("common.delete")}
                              onClick={() => deleteFrontmatterField(field.lineIndex)}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_auto] gap-1">
                      <input
                        value={newFrontmatterKey}
                        onChange={(event) => setNewFrontmatterKey(event.target.value)}
                        placeholder={t("common.name")}
                        className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                      />
                      <input
                        value={newFrontmatterValue}
                        onChange={(event) => setNewFrontmatterValue(event.target.value)}
                        placeholder={t("documentEditor.value", { defaultValue: "Value" })}
                        className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
                      />
                      <ToolbarButton
                        icon={Plus}
                        label={t("common.add")}
                        onClick={addFrontmatterField}
                        disabled={!newFrontmatterKey.trim()}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={removeFrontmatter}
                      className="w-full rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                    >
                      {t("documentEditor.removeFrontmatter", { defaultValue: "Remove frontmatter" })}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={openFrontmatterPanel}
                    className="w-full rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--accent)] hover:bg-[var(--surface-hover)]"
                  >
                    {t("documentEditor.createFrontmatter", { defaultValue: "Create frontmatter" })}
                  </button>
                )}
              </div>
            )}
          </aside>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[11px] text-[var(--text-faint)]">
        <span>
          L{cursor.line}:C{cursor.column}
          {cursor.selection > 0 ? ` · ${cursor.selection} selected` : ""}
        </span>
        <span>
          {stats.lines} lines · {stats.words} words · {stats.characters} chars · {stats.headings} headings
        </span>
      </div>
    </div>
  );
}

function modeButtonClass(active: boolean) {
  return [
    "rounded-md border px-2 py-1 text-xs",
    active
      ? "border-[var(--accent)] bg-[var(--surface-hover)] text-[var(--text)]"
      : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
  ].join(" ");
}

function markdownTextButtonClass() {
  return "inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]";
}

function markdownPreviewComponents(filePath: string): Components {
  return {
    code({ className, children, ...props }) {
      const match = /language-([\w-]+)/.exec(className ?? "");
      if (!match) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      }
      return (
        <HighlightedCodeBlock
          code={String(children).replace(/\n$/, "")}
          language={match[1]}
        />
      );
    },
    a({ href, children, ...props }) {
      const resolved = resolveMarkdownReference(filePath, href);
      const external = isExternalReference(resolved.href);
      return (
        <a
          {...props}
          href={resolved.href}
          rel={external ? "noreferrer" : undefined}
          target={external ? "_blank" : undefined}
        >
          {children}
        </a>
      );
    },
    img({ src, alt, ...props }) {
      const resolved = resolveMarkdownReference(filePath, src);
      return (
        <img
          {...props}
          alt={alt ?? ""}
          className="max-w-full rounded-md border border-[var(--border)]"
          src={resolved.href}
        />
      );
    },
  };
}

function resolveMarkdownReference(filePath: string, value: string | undefined) {
  if (!value) return { href: undefined };
  if (isBrowserHandledReference(value)) return { href: value };
  const [pathAndQuery, fragment = ""] = value.split("#", 2);
  const [pathOnly, query = ""] = pathAndQuery.split("?", 2);
  const logicalPath = markdownReferencePath(filePath, pathOnly);
  if (!logicalPath) return { href: value };
  let href = driveBlobUrl(logicalPath);
  if (query) href = `${href}&${query}`;
  if (fragment) href = `${href}#${fragment}`;
  return { href };
}

function markdownReferencePath(filePath: string, reference: string) {
  if (!reference) return null;
  if (reference.startsWith("/drive/")) return normalizeDriveReference(reference);
  if (reference.startsWith("/")) return null;
  return normalizeDriveReference(`${parentPath(filePath)}/${reference}`);
}

function markdownRelativeFileReference(
  filePath: string,
  uploadedPath: string,
  uploadedName: string,
) {
  return parentPath(uploadedPath) === parentPath(filePath) ? uploadedName : uploadedPath;
}

function normalizeDriveReference(value: string) {
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 1) parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (parts[0] !== "drive") return null;
  return `/${parts.join("/")}`;
}

function isBrowserHandledReference(value: string) {
  return (
    value.startsWith("#") ||
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    value.startsWith("//")
  );
}

function isExternalReference(value: string | undefined) {
  return Boolean(value && (/^https?:\/\//i.test(value) || value.startsWith("//")));
}
