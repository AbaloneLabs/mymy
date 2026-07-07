import type { RefObject } from "react";
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
  ListTodo,
  ListTree,
  Loader2,
  Plus,
  Quote,
  Search,
  Strikethrough,
  Table,
  Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { markdownTextButtonClass, modeButtonClass } from "./markdownEditorChrome";
import type { MarkdownSidePanelKind } from "./markdownSidePanel";
import type { MarkdownHeadingLevel } from "./markdownEditorUtils";
import { ToolbarButton } from "./shared";

export function MarkdownEditorToolbar({
  mode,
  sidePanel,
  searchOpen,
  linkInputOpen,
  linkDraft,
  imageInputOpen,
  imageDraft,
  imageAltDraft,
  uploadingImage,
  imageUploadError,
  imageFileInputRef,
  onApplyHeading,
  onWrapSelection,
  onApplyBulletList,
  onApplyNumberedList,
  onInsertTaskList,
  onApplyBlockquote,
  onApplyInlineCode,
  onToggleLinkInput,
  onToggleImageInput,
  onOpenTablePanel,
  onInsertFootnote,
  onToggleOutlinePanel,
  onOpenFrontmatterPanel,
  onToggleReferencesPanel,
  onToggleSearch,
  onOpenGoToLine,
  onTogglePreview,
  onSubmitLink,
  onLinkDraftChange,
  onSubmitImage,
  onImageDraftChange,
  onImageAltDraftChange,
  onUploadImageFile,
}: {
  mode: "source" | "preview";
  sidePanel: MarkdownSidePanelKind | null;
  searchOpen: boolean;
  linkInputOpen: boolean;
  linkDraft: string;
  imageInputOpen: boolean;
  imageDraft: string;
  imageAltDraft: string;
  uploadingImage: boolean;
  imageUploadError: string | null;
  imageFileInputRef: RefObject<HTMLInputElement | null>;
  onApplyHeading: (level: MarkdownHeadingLevel) => void;
  onWrapSelection: (before: string, after?: string) => void;
  onApplyBulletList: () => void;
  onApplyNumberedList: () => void;
  onInsertTaskList: () => void;
  onApplyBlockquote: () => void;
  onApplyInlineCode: () => void;
  onToggleLinkInput: () => void;
  onToggleImageInput: () => void;
  onOpenTablePanel: () => void;
  onInsertFootnote: () => void;
  onToggleOutlinePanel: () => void;
  onOpenFrontmatterPanel: () => void;
  onToggleReferencesPanel: () => void;
  onToggleSearch: () => void;
  onOpenGoToLine: () => void;
  onTogglePreview: () => void;
  onSubmitLink: () => void;
  onLinkDraftChange: (value: string) => void;
  onSubmitImage: () => void;
  onImageDraftChange: (value: string) => void;
  onImageAltDraftChange: (value: string) => void;
  onUploadImageFile: (file: File) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--border)] px-3 py-2">
      <ToolbarButton icon={Heading1} label="H1" onClick={() => onApplyHeading(1)} />
      <ToolbarButton icon={Heading2} label="H2" onClick={() => onApplyHeading(2)} />
      <ToolbarButton icon={Heading3} label="H3" onClick={() => onApplyHeading(3)} />
      <ToolbarButton icon={Heading4} label="H4" onClick={() => onApplyHeading(4)} />
      <ToolbarButton icon={Heading5} label="H5" onClick={() => onApplyHeading(5)} />
      <ToolbarButton icon={Heading6} label="H6" onClick={() => onApplyHeading(6)} />
      <ToolbarButton
        icon={Bold}
        label={t("documentEditor.bold")}
        onClick={() => onWrapSelection("**")}
      />
      <ToolbarButton
        icon={Italic}
        label={t("documentEditor.italic")}
        onClick={() => onWrapSelection("*")}
      />
      <ToolbarButton
        icon={Strikethrough}
        label="Strike"
        onClick={() => onWrapSelection("~~")}
      />
      <ToolbarButton
        icon={List}
        label={t("documentEditor.bullets")}
        onClick={onApplyBulletList}
      />
      <ToolbarButton
        icon={ListOrdered}
        label={t("documentEditor.numbered")}
        onClick={onApplyNumberedList}
      />
      <ToolbarButton icon={ListTodo} label="Task list" onClick={onInsertTaskList} />
      <ToolbarButton
        icon={Quote}
        label={t("documentEditor.quote")}
        onClick={onApplyBlockquote}
      />
      <ToolbarButton
        icon={Code}
        label={t("documentEditor.code")}
        onClick={onApplyInlineCode}
      />
      <ToolbarButton
        icon={Link}
        label={t("documentEditor.link")}
        onClick={onToggleLinkInput}
      />
      <ToolbarButton icon={Image} label="Image" onClick={onToggleImageInput} />
      <ToolbarButton
        icon={Table}
        label={t("documentEditor.table")}
        active={sidePanel === "table"}
        onClick={onOpenTablePanel}
      />
      <ToolbarButton
        icon={Plus}
        label={t("documentEditor.footnote", { defaultValue: "Footnote" })}
        onClick={onInsertFootnote}
      />
      <ToolbarButton
        icon={ListTree}
        label={t("documentEditor.outline", { defaultValue: "Outline" })}
        active={sidePanel === "outline"}
        onClick={onToggleOutlinePanel}
      />
      <ToolbarButton
        icon={FileCog}
        label={t("documentEditor.frontmatter", { defaultValue: "Frontmatter" })}
        active={sidePanel === "frontmatter"}
        onClick={onOpenFrontmatterPanel}
      />
      <ToolbarButton
        icon={Link}
        label={t("documentEditor.references", { defaultValue: "References" })}
        active={sidePanel === "references"}
        onClick={onToggleReferencesPanel}
      />
      <ToolbarButton
        icon={Search}
        label={t("documentEditor.find", { defaultValue: "Find" })}
        active={searchOpen}
        onClick={onToggleSearch}
      />
      <button type="button" onClick={onOpenGoToLine} className={markdownTextButtonClass()}>
        L:
        {t("documentEditor.goToLine", { defaultValue: "Go to line" })}
      </button>
      <button
        type="button"
        onClick={onTogglePreview}
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
            onSubmitLink();
          }}
        >
          <input
            value={linkDraft}
            onChange={(event) => onLinkDraftChange(event.target.value)}
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
            onSubmitImage();
          }}
        >
          <input
            value={imageDraft}
            onChange={(event) => onImageDraftChange(event.target.value)}
            placeholder="Image path or URL"
            className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <input
            value={imageAltDraft}
            onChange={(event) => onImageAltDraftChange(event.target.value)}
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
              if (file) onUploadImageFile(file);
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
  );
}
