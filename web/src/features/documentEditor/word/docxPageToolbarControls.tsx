import { useTranslation } from "react-i18next";
import {
  DOCX_PAGE_PRESETS,
  docxPagePresetValue,
  pointsToTwips,
  twipsToPoints,
} from "./docxEditorUtils";
import { DocxMarginInput } from "./docxPageLayoutControls";
import type { DocxEditorToolbarProps } from "./docxEditorToolbarTypes";

type DocxPageToolbarControlsProps = Pick<
  DocxEditorToolbarProps,
  | "onUpdatePage"
  | "onApplyPageDraft"
  | "onCancelPageDraft"
  | "onUpdatePageOrientation"
  | "onUpdatePagePreset"
  | "page"
  | "pageDraftDirty"
  | "pageScopeLabel"
>;

export function DocxPageToolbarControls({
  onApplyPageDraft,
  onCancelPageDraft,
  onUpdatePage,
  onUpdatePageOrientation,
  onUpdatePagePreset,
  page,
  pageDraftDirty,
  pageScopeLabel,
}: DocxPageToolbarControlsProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="mx-1 h-5 w-px bg-[var(--border)]" />
      <span
        className="max-w-44 truncate rounded bg-[var(--surface)] px-2 py-1 text-[10px] text-[var(--text-muted)]"
        title={`${pageScopeLabel}. Page changes remain a draft until Apply.`}
      >
        {pageScopeLabel}
      </span>
      <select
        value={docxPagePresetValue(page)}
        onChange={(event) => onUpdatePagePreset(event.target.value)}
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        title={t("documentEditor.pageSize", {
          defaultValue: "Page size",
        })}
      >
        <option value="custom">Custom</option>
        {DOCX_PAGE_PRESETS.map((preset) => (
          <option key={preset.value} value={preset.value}>
            {preset.label}
          </option>
        ))}
      </select>
      <select
        value={page?.orientation ?? "portrait"}
        onChange={(event) =>
          onUpdatePageOrientation(
            event.target.value === "landscape" ? "landscape" : "portrait",
          )
        }
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        title={t("documentEditor.pageOrientation", {
          defaultValue: "Page orientation",
        })}
      >
        <option value="portrait">Portrait</option>
        <option value="landscape">Landscape</option>
      </select>
      <select
        value={page?.columnCount ?? 1}
        onChange={(event) =>
          onUpdatePage({
            columnCount: Number(event.target.value),
            columnEqualWidth: true,
          })
        }
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
        title="Columns"
      >
        {Array.from({ length: 6 }, (_, index) => index + 1).map((count) => (
          <option key={count} value={count}>
            {count} column{count === 1 ? "" : "s"}
          </option>
        ))}
      </select>
      <label className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11px] text-[var(--text-muted)]">
        Gap
        <input
          type="number"
          min={0}
          max={144}
          value={twipsToPoints(page?.columnSpacing ?? 720)}
          onChange={(event) =>
            onUpdatePage({
              columnSpacing: pointsToTwips(Number(event.target.value)),
              columnEqualWidth: true,
            })
          }
          className="w-12 bg-transparent text-xs text-[var(--text)] outline-none"
        />
      </label>
      <DocxMarginInput
        label="Top"
        value={page?.marginTop}
        onChange={(marginTop) => onUpdatePage({ marginTop })}
      />
      <DocxMarginInput
        label="Right"
        value={page?.marginRight}
        onChange={(marginRight) => onUpdatePage({ marginRight })}
      />
      <DocxMarginInput
        label="Bottom"
        value={page?.marginBottom}
        onChange={(marginBottom) => onUpdatePage({ marginBottom })}
      />
      <DocxMarginInput
        label="Left"
        value={page?.marginLeft}
        onChange={(marginLeft) => onUpdatePage({ marginLeft })}
      />
      <button
        type="button"
        onClick={onApplyPageDraft}
        disabled={!pageDraftDirty}
        className="h-8 rounded-md border border-[var(--accent)] px-2 text-xs text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
        title={`Apply page settings to ${pageScopeLabel}`}
      >
        Apply
      </button>
      <button
        type="button"
        onClick={onCancelPageDraft}
        disabled={!pageDraftDirty}
        className="h-8 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Discard the page-setting draft and restore the original section"
      >
        Cancel
      </button>
    </>
  );
}
