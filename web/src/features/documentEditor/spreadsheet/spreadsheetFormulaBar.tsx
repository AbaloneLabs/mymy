import { useRef, useState } from "react";
import { Sigma } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { XlsxCell } from "../shared/models";
import type { SpreadsheetFormulaFunction } from "./spreadsheetFormulaTypes";
import { spreadsheetCellEditCommitValue } from "./spreadsheetCellEditTransaction";
import {
  applySpreadsheetFormulaSuggestion,
  spreadsheetFormulaSuggestions,
} from "./spreadsheetPresentation";

type SpreadsheetFormulaBarProps = {
  activeCellDisabled: boolean;
  activeCellFormulaMetadata?: XlsxCell;
  activeCellLabel: string;
  activeCellValue: string;
  showFormulas?: boolean;
  onActiveCellChange: (value: string) => void;
  onActiveCellFormulaMetadataChange?: (
    patch: Pick<XlsxCell, "formulaType" | "formulaRef" | "formulaSharedIndex">,
  ) => void;
  onActiveCellLabelChange: (value: string) => void;
  onToggleShowFormulas?: () => void;
};

export function SpreadsheetFormulaBar({
  activeCellDisabled,
  activeCellFormulaMetadata,
  activeCellLabel,
  activeCellValue,
  showFormulas = false,
  onActiveCellChange,
  onActiveCellFormulaMetadataChange,
  onActiveCellLabelChange,
  onToggleShowFormulas,
}: SpreadsheetFormulaBarProps) {
  const { t } = useTranslation();
  const [formulaHelpOpen, setFormulaHelpOpen] = useState(false);
  const [formulaSuggestionIndex, setFormulaSuggestionIndex] = useState(0);
  const [editingFormula, setEditingFormula] = useState(false);
  const [formulaDraft, setFormulaDraft] = useState(activeCellValue);
  const formulaOriginalRef = useRef(activeCellValue);
  const formulaCancelledRef = useRef(false);
  const effectiveFormulaValue = editingFormula ? formulaDraft : activeCellValue;
  const formulaSuggestions = spreadsheetFormulaSuggestions(effectiveFormulaValue);
  const formulaType = activeCellFormulaMetadata?.formulaType ?? "";
  const formulaRef = activeCellFormulaMetadata?.formulaRef ?? "";
  const formulaSharedIndex = activeCellFormulaMetadata?.formulaSharedIndex ?? "";
  const formulaMetadataVisible =
    !activeCellDisabled &&
    Boolean(
      effectiveFormulaValue.startsWith("=") ||
        formulaType ||
        formulaRef ||
        formulaSharedIndex,
    );
  const formulaPopoverOpen =
    formulaHelpOpen && !activeCellDisabled && formulaSuggestions.length > 0;

  function applyFormulaSuggestion(suggestion: SpreadsheetFormulaFunction) {
    setFormulaDraft(
      applySpreadsheetFormulaSuggestion(effectiveFormulaValue, suggestion.name),
    );
    setFormulaHelpOpen(false);
    setFormulaSuggestionIndex(0);
  }

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const value = data.get("cellReference");
          if (typeof value === "string") onActiveCellLabelChange(value);
        }}
      >
        <input
          key={activeCellLabel}
          name="cellReference"
          defaultValue={activeCellLabel}
          className="h-8 w-24 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 font-mono text-xs text-[var(--text-muted)] outline-none focus:border-[var(--accent)] focus:text-[var(--text)]"
          aria-label={t("documentEditor.nameBox", {
            defaultValue: "Name box",
          })}
        />
      </form>
      <div className="relative min-w-72 flex-1">
        <input
          value={effectiveFormulaValue}
          onChange={(event) => {
            setFormulaDraft(event.target.value);
            setFormulaHelpOpen(true);
            setFormulaSuggestionIndex(0);
          }}
          onFocus={() => {
            formulaOriginalRef.current = activeCellValue;
            formulaCancelledRef.current = false;
            setFormulaDraft(activeCellValue);
            setEditingFormula(true);
            setFormulaHelpOpen(true);
          }}
          onBlur={() => {
            const committed = spreadsheetCellEditCommitValue(
              formulaOriginalRef.current,
              formulaDraft,
              formulaCancelledRef.current,
            );
            formulaCancelledRef.current = false;
            setEditingFormula(false);
            setFormulaHelpOpen(false);
            if (committed !== null) onActiveCellChange(committed);
          }}
          onKeyDown={(event) => {
            if (formulaPopoverOpen && event.key === "ArrowDown") {
              event.preventDefault();
              setFormulaSuggestionIndex((current) =>
                Math.min(current + 1, formulaSuggestions.length - 1),
              );
            } else if (formulaPopoverOpen && event.key === "ArrowUp") {
              event.preventDefault();
              setFormulaSuggestionIndex((current) => Math.max(current - 1, 0));
            } else if (
              formulaPopoverOpen &&
              (event.key === "Enter" || event.key === "Tab")
            ) {
              event.preventDefault();
              applyFormulaSuggestion(
                formulaSuggestions[
                  Math.min(formulaSuggestionIndex, formulaSuggestions.length - 1)
                ],
              );
            } else if (event.key === "Escape") {
              event.preventDefault();
              formulaCancelledRef.current = true;
              setFormulaDraft(formulaOriginalRef.current);
              setFormulaHelpOpen(false);
              event.currentTarget.blur();
            } else if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          disabled={activeCellDisabled}
          className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          placeholder={t("documentEditor.formulaBar", { defaultValue: "Formula bar" })}
          aria-autocomplete="list"
        />
        {formulaPopoverOpen && (
          <div className="absolute left-0 right-0 top-9 z-30 max-h-72 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg">
            {formulaSuggestions.map((suggestion, index) => (
              <button
                key={suggestion.name}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  applyFormulaSuggestion(suggestion);
                }}
                onMouseEnter={() => setFormulaSuggestionIndex(index)}
                className={cn(
                  "block w-full rounded-md px-2 py-1.5 text-left",
                  index === formulaSuggestionIndex
                    ? "bg-[var(--accent)]/10"
                    : "hover:bg-[var(--surface-hover)]",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-[var(--accent)]">
                    {suggestion.name}
                  </span>
                  <span className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                    {suggestion.signature}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] uppercase text-[var(--text-faint)]">
                    {suggestion.category}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-[var(--text-faint)]">
                  {suggestion.description}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {onToggleShowFormulas && (
        <button
          type="button"
          onClick={onToggleShowFormulas}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
            showFormulas && "border-[var(--accent)] text-[var(--accent)]",
          )}
          title={t("documentEditor.toggleFormulas", {
            defaultValue: "Toggle formulas",
          })}
        >
          <Sigma className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      )}
      {formulaMetadataVisible && onActiveCellFormulaMetadataChange && (
        <div className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1 py-0.5">
          <select
            value={formulaType}
            onChange={(event) => {
              const nextType = event.currentTarget.value || undefined;
              onActiveCellFormulaMetadataChange({
                formulaType: nextType,
                formulaRef: nextType ? formulaRef || undefined : undefined,
                formulaSharedIndex:
                  nextType === "shared"
                    ? formulaSharedIndex || undefined
                    : nextType
                      ? formulaSharedIndex || undefined
                      : undefined,
              });
            }}
            className="h-7 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[10px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            title="Formula metadata type"
          >
            <option value="">Normal</option>
            <option value="array">Array</option>
            <option value="shared">Shared</option>
            <option value="dataTable">Data table</option>
          </select>
          <input
            value={formulaRef}
            onChange={(event) =>
              onActiveCellFormulaMetadataChange({
                formulaRef: event.currentTarget.value.trim() || undefined,
              })
            }
            placeholder="ref"
            disabled={!formulaType}
            className="h-7 w-20 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 font-mono text-[10px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            title="Formula reference range"
          />
          <input
            value={formulaSharedIndex}
            onChange={(event) =>
              onActiveCellFormulaMetadataChange({
                formulaSharedIndex:
                  event.currentTarget.value.replace(/\D/g, "") || undefined,
              })
            }
            placeholder="si"
            disabled={!formulaType}
            className="h-7 w-12 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 font-mono text-[10px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            title="Shared formula index"
          />
        </div>
      )}
    </>
  );
}
