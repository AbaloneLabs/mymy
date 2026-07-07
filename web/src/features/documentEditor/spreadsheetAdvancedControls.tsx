import {
  Eraser,
  Link,
  Lock,
  MessageSquare,
  PaintBucket,
  Printer,
  Unlink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  XlsxComment,
  XlsxConditionalRule,
  XlsxDataValidation,
  XlsxHyperlink,
  XlsxPageMargins,
  XlsxPageSetup,
  XlsxSheetProtection,
} from "./models";
import { optionalTrimmedString } from "./spreadsheetPresentation";

/**
 * Advanced spreadsheet controls edit workbook metadata that sits beside normal
 * cell values: validation, conditional formatting, hyperlinks, comments, and
 * sheet print/protection settings. These controls are kept outside the main
 * grid editor so the editor's core state machine stays focused on selection and
 * model mutation.
 */
type XlsxDataValidationType = NonNullable<XlsxDataValidation["type"]>;
type XlsxDataValidationOperator = NonNullable<XlsxDataValidation["operator"]>;
type XlsxConditionalRuleType = NonNullable<XlsxConditionalRule["type"]>;
type XlsxConditionalOperator = NonNullable<XlsxConditionalRule["operator"]>;

const XLSX_VALIDATION_TYPES: Array<{
  label: string;
  value: "" | XlsxDataValidationType;
}> = [
  { label: "No validation", value: "" },
  { label: "Dropdown list", value: "list" },
  { label: "Whole number", value: "whole" },
  { label: "Decimal", value: "decimal" },
  { label: "Date", value: "date" },
  { label: "Time", value: "time" },
  { label: "Text length", value: "textLength" },
  { label: "Custom formula", value: "custom" },
];

const XLSX_VALIDATION_OPERATORS: Array<{
  label: string;
  value: XlsxDataValidationOperator;
}> = [
  { label: "Between", value: "between" },
  { label: "Not between", value: "notBetween" },
  { label: "Equal", value: "equal" },
  { label: "Not equal", value: "notEqual" },
  { label: "Greater than", value: "greaterThan" },
  { label: "Less than", value: "lessThan" },
  { label: "At least", value: "greaterThanOrEqual" },
  { label: "At most", value: "lessThanOrEqual" },
];

const XLSX_CONDITIONAL_RULE_TYPES: Array<{
  label: string;
  value: "" | XlsxConditionalRuleType;
}> = [
  { label: "No conditional rule", value: "" },
  { label: "Cell value", value: "cellIs" },
  { label: "Custom formula", value: "expression" },
  { label: "Text contains", value: "containsText" },
  { label: "Duplicate values", value: "duplicateValues" },
  { label: "Blank cells", value: "blanks" },
  { label: "Errors", value: "errors" },
];

const XLSX_CONDITIONAL_OPERATORS: Array<{
  label: string;
  value: XlsxConditionalOperator;
}> = [
  { label: "Greater than", value: "greaterThan" },
  { label: "At least", value: "greaterThanOrEqual" },
  { label: "Less than", value: "lessThan" },
  { label: "At most", value: "lessThanOrEqual" },
  { label: "Equal", value: "equal" },
  { label: "Not equal", value: "notEqual" },
  { label: "Between", value: "between" },
  { label: "Not between", value: "notBetween" },
];

export function SpreadsheetValidationControls({
  validation,
  disabled,
  onChange,
}: {
  validation?: XlsxDataValidation;
  disabled: boolean;
  onChange: (validation: XlsxDataValidation | null) => void;
}) {
  const type = validation?.type ?? "";
  const operator = validation?.operator ?? "between";

  function patchValidation(patch: Partial<XlsxDataValidation>) {
    const nextType = patch.type ?? validation?.type ?? "list";
    onChange({
      sqref: validation?.sqref ?? "",
      type: nextType,
      operator:
        nextType === "list" || nextType === "custom"
          ? undefined
          : (patch.operator ?? validation?.operator ?? "between"),
      formula1: patch.formula1 ?? validation?.formula1,
      formula2:
        nextType === "list" || nextType === "custom"
          ? undefined
          : (patch.formula2 ?? validation?.formula2),
      allowBlank: patch.allowBlank ?? validation?.allowBlank ?? true,
      showInputMessage:
        patch.showInputMessage ?? validation?.showInputMessage ?? false,
      showErrorMessage:
        patch.showErrorMessage ?? validation?.showErrorMessage ?? true,
      promptTitle: patch.promptTitle ?? validation?.promptTitle,
      prompt: patch.prompt ?? validation?.prompt,
      errorTitle: patch.errorTitle ?? validation?.errorTitle,
      error: patch.error ?? validation?.error,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1 py-1">
      <select
        value={type}
        disabled={disabled}
        onChange={(event) => {
          const nextType = event.currentTarget.value as "" | XlsxDataValidationType;
          if (!nextType) {
            onChange(null);
            return;
          }
          patchValidation({
            type: nextType,
            formula1:
              nextType === "list"
                ? (validation?.formula1 ?? '"Option 1,Option 2"')
                : validation?.formula1,
          });
        }}
        className="h-7 w-32 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        title="Data validation"
      >
        {XLSX_VALIDATION_TYPES.map((item) => (
          <option key={item.label} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      {type && type !== "list" && type !== "custom" && (
        <select
          value={operator}
          disabled={disabled}
          onChange={(event) =>
            patchValidation({
              operator: event.currentTarget.value as XlsxDataValidationOperator,
            })
          }
          className="h-7 w-28 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          title="Validation operator"
        >
          {XLSX_VALIDATION_OPERATORS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      )}
      {type && (
        <input
          value={validation?.formula1 ?? ""}
          disabled={disabled}
          onChange={(event) => patchValidation({ formula1: event.target.value })}
          className="h-7 w-40 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          placeholder={
            type === "list"
              ? '"A,B,C" or =$A$1:$A$3'
              : type === "custom"
                ? "=A1>0"
                : "Formula 1"
          }
          title="Validation formula 1"
        />
      )}
      {type &&
        type !== "list" &&
        type !== "custom" &&
        (operator === "between" || operator === "notBetween") && (
          <input
            value={validation?.formula2 ?? ""}
            disabled={disabled}
            onChange={(event) => patchValidation({ formula2: event.target.value })}
            className="h-7 w-28 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            placeholder="Formula 2"
            title="Validation formula 2"
          />
        )}
      {type && (
        <>
          <label className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={validation?.allowBlank ?? true}
              disabled={disabled}
              onChange={(event) =>
                patchValidation({ allowBlank: event.currentTarget.checked })
              }
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Blank
          </label>
          <label className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={validation?.showErrorMessage ?? true}
              disabled={disabled}
              onChange={(event) =>
                patchValidation({
                  showErrorMessage: event.currentTarget.checked,
                })
              }
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Error
          </label>
          <input
            value={validation?.errorTitle ?? ""}
            disabled={disabled}
            onChange={(event) => patchValidation({ errorTitle: event.target.value })}
            className="h-7 w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            placeholder="Error title"
            title="Validation error title"
          />
          <input
            value={validation?.error ?? ""}
            disabled={disabled}
            onChange={(event) => patchValidation({ error: event.target.value })}
            className="h-7 w-36 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            placeholder="Error message"
            title="Validation error message"
          />
        </>
      )}
    </div>
  );
}

export function SpreadsheetConditionalFormattingControls({
  rule,
  disabled,
  onChange,
}: {
  rule?: XlsxConditionalRule;
  disabled: boolean;
  onChange: (rule: XlsxConditionalRule | null) => void;
}) {
  const type = rule?.type ?? "";
  const operator = rule?.operator ?? "greaterThan";
  const formulas = rule?.formulas ?? [];
  const fillColor = rule?.fillColor ?? "#e7f5d8";

  function patchRule(patch: Partial<XlsxConditionalRule>) {
    const nextType = patch.type ?? rule?.type ?? "cellIs";
    const nextOperator =
      nextType === "cellIs"
        ? (patch.operator ?? rule?.operator ?? "greaterThan")
        : undefined;
    const nextFormulas =
      patch.formulas ??
      rule?.formulas ??
      (nextType === "expression" ? ["=A1>0"] : [""]);
    onChange({
      type: nextType,
      operator: nextOperator,
      formulas:
        nextType === "duplicateValues" ||
        nextType === "blanks" ||
        nextType === "errors"
          ? undefined
          : nextFormulas,
      text:
        nextType === "containsText"
          ? (patch.text ?? rule?.text ?? nextFormulas[0] ?? "")
          : undefined,
      fillColor: patch.fillColor ?? rule?.fillColor ?? fillColor,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1 py-1">
      <select
        value={type}
        disabled={disabled}
        onChange={(event) => {
          const nextType = event.currentTarget.value as "" | XlsxConditionalRuleType;
          if (!nextType) {
            onChange(null);
            return;
          }
          patchRule({
            type: nextType,
            formulas:
              nextType === "expression"
                ? (rule?.formulas ?? ["=A1>0"])
                : rule?.formulas,
          });
        }}
        className="h-7 w-36 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        title="Conditional formatting"
      >
        {XLSX_CONDITIONAL_RULE_TYPES.map((item) => (
          <option key={item.label} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      {type === "cellIs" && (
        <select
          value={operator}
          disabled={disabled}
          onChange={(event) =>
            patchRule({
              operator: event.currentTarget.value as XlsxConditionalOperator,
            })
          }
          className="h-7 w-28 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          title="Conditional operator"
        >
          {XLSX_CONDITIONAL_OPERATORS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      )}
      {(type === "cellIs" ||
        type === "expression" ||
        type === "containsText") && (
        <input
          value={type === "containsText" ? (rule?.text ?? "") : (formulas[0] ?? "")}
          disabled={disabled}
          onChange={(event) =>
            patchRule({
              formulas: [event.target.value],
              text: event.target.value,
            })
          }
          className="h-7 w-32 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          placeholder={
            type === "expression"
              ? "=A1>0"
              : type === "containsText"
                ? "Text"
                : "Value"
          }
          title="Conditional formula or text"
        />
      )}
      {type === "cellIs" &&
        (operator === "between" || operator === "notBetween") && (
          <input
            value={formulas[1] ?? ""}
            disabled={disabled}
            onChange={(event) =>
              patchRule({
                formulas: [formulas[0] ?? "", event.target.value],
              })
            }
            className="h-7 w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            placeholder="Value 2"
            title="Second conditional value"
          />
        )}
      {type && (
        <label
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]",
            disabled && "pointer-events-none opacity-50",
          )}
          title="Conditional fill color"
        >
          <PaintBucket className="h-3.5 w-3.5" strokeWidth={1.75} />
          <input
            type="color"
            value={fillColor}
            disabled={disabled}
            onChange={(event) => patchRule({ fillColor: event.target.value })}
            className="sr-only"
          />
        </label>
      )}
    </div>
  );
}

export function SpreadsheetHyperlinkControls({
  hyperlink,
  disabled,
  onChange,
}: {
  hyperlink?: XlsxHyperlink;
  disabled: boolean;
  onChange: (hyperlink: XlsxHyperlink | null) => void;
}) {
  const mode = hyperlink?.location ? "location" : hyperlink?.target ? "target" : "";

  function patchHyperlink(
    patch: Partial<XlsxHyperlink>,
    nextMode: "target" | "location" = mode === "location" ? "location" : "target",
  ) {
    const display = optionalTrimmedString(
      patch.display ?? hyperlink?.display,
    );
    const tooltip = optionalTrimmedString(
      patch.tooltip ?? hyperlink?.tooltip,
    );
    if (nextMode === "location") {
      const location = optionalTrimmedString(
        patch.location ?? hyperlink?.location ?? "Sheet1!A1",
      );
      if (!location) {
        onChange(null);
        return;
      }
      onChange({
        ref: hyperlink?.ref ?? "",
        location,
        display,
        tooltip,
      });
      return;
    }
    const target = optionalTrimmedString(
      patch.target ?? hyperlink?.target ?? "https://",
    );
    if (!target) {
      onChange(null);
      return;
    }
    onChange({
      ref: hyperlink?.ref ?? "",
      target,
      display,
      tooltip,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1 py-1">
      <Link className="ml-1 h-3.5 w-3.5 text-[var(--text-muted)]" strokeWidth={1.75} />
      <select
        value={mode}
        disabled={disabled}
        onChange={(event) => {
          const nextMode = event.currentTarget.value as "" | "target" | "location";
          if (!nextMode) {
            onChange(null);
            return;
          }
          patchHyperlink({}, nextMode);
        }}
        className="h-7 w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        title="Hyperlink"
      >
        <option value="">No link</option>
        <option value="target">URL</option>
        <option value="location">Sheet</option>
      </select>
      {mode === "target" && (
        <input
          value={hyperlink?.target ?? ""}
          disabled={disabled}
          onChange={(event) => patchHyperlink({ target: event.target.value }, "target")}
          className="h-7 w-48 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          placeholder="https://example.com"
          title="Hyperlink target URL"
        />
      )}
      {mode === "location" && (
        <input
          value={hyperlink?.location ?? ""}
          disabled={disabled}
          onChange={(event) =>
            patchHyperlink({ location: event.target.value }, "location")
          }
          className="h-7 w-32 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
          placeholder="Sheet1!A1"
          title="Hyperlink sheet location"
        />
      )}
      {mode && (
        <>
          <input
            value={hyperlink?.display ?? ""}
            disabled={disabled}
            onChange={(event) =>
              patchHyperlink({ display: event.target.value })
            }
            className="h-7 w-28 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            placeholder="Display"
            title="Hyperlink display text"
          />
          <input
            value={hyperlink?.tooltip ?? ""}
            disabled={disabled}
            onChange={(event) =>
              patchHyperlink({ tooltip: event.target.value })
            }
            className="h-7 w-28 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
            placeholder="Tooltip"
            title="Hyperlink tooltip"
          />
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
            title="Remove hyperlink"
          >
            <Unlink className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </>
      )}
    </div>
  );
}

export function SpreadsheetCommentControls({
  comment,
  disabled,
  onChange,
}: {
  comment?: XlsxComment;
  disabled: boolean;
  onChange: (comment: XlsxComment | null) => void;
}) {
  function patchComment(patch: Partial<XlsxComment>) {
    const text = patch.text ?? comment?.text ?? "";
    if (!text.trim()) {
      onChange(null);
      return;
    }
    onChange({
      ref: comment?.ref ?? "",
      author: optionalTrimmedString(patch.author ?? comment?.author),
      text,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1 py-1">
      <MessageSquare className="ml-1 h-3.5 w-3.5 text-[var(--text-muted)]" strokeWidth={1.75} />
      <input
        value={comment?.author ?? ""}
        disabled={disabled}
        onChange={(event) => patchComment({ author: event.target.value })}
        className="h-7 w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        placeholder="Author"
        title="Comment author"
      />
      <textarea
        value={comment?.text ?? ""}
        disabled={disabled}
        onChange={(event) => patchComment({ text: event.target.value })}
        className="h-7 w-48 resize-none rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        placeholder="Comment"
        title="Cell comment"
      />
      {comment && (
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Remove comment"
        >
          <Eraser className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

export function SpreadsheetSheetSettingsControls({
  protection,
  pageMargins,
  pageSetup,
  onChange,
}: {
  protection?: XlsxSheetProtection;
  pageMargins?: XlsxPageMargins;
  pageSetup?: XlsxPageSetup;
  onChange: (patch: {
    protection?: XlsxSheetProtection;
    pageMargins?: XlsxPageMargins;
    pageSetup?: XlsxPageSetup;
  }) => void;
}) {
  const margins = pageMargins ?? {
    left: 0.7,
    right: 0.7,
    top: 0.75,
    bottom: 0.75,
    header: 0.3,
    footer: 0.3,
  };
  const setup: XlsxPageSetup = pageSetup ?? {
    orientation: "portrait",
    paperSize: 9,
    scale: 100,
  };

  function updateProtection(patch: Partial<XlsxSheetProtection>) {
    const enabled = patch.enabled ?? protection?.enabled ?? false;
    onChange({
      protection: enabled
        ? {
            enabled,
            password: protection?.password,
            objects: patch.objects ?? protection?.objects ?? true,
            scenarios: patch.scenarios ?? protection?.scenarios ?? true,
            formatCells: patch.formatCells ?? protection?.formatCells ?? false,
            formatColumns:
              patch.formatColumns ?? protection?.formatColumns ?? false,
            formatRows: patch.formatRows ?? protection?.formatRows ?? false,
            insertColumns:
              patch.insertColumns ?? protection?.insertColumns ?? false,
            insertRows: patch.insertRows ?? protection?.insertRows ?? false,
            insertHyperlinks:
              patch.insertHyperlinks ?? protection?.insertHyperlinks ?? false,
            deleteColumns:
              patch.deleteColumns ?? protection?.deleteColumns ?? false,
            deleteRows: patch.deleteRows ?? protection?.deleteRows ?? false,
            sort: patch.sort ?? protection?.sort ?? false,
            autoFilter: patch.autoFilter ?? protection?.autoFilter ?? false,
            pivotTables: patch.pivotTables ?? protection?.pivotTables ?? false,
          }
        : undefined,
    });
  }

  function updateMargins(patch: Partial<XlsxPageMargins>) {
    onChange({ pageMargins: { ...margins, ...patch } });
  }

  function updateSetup(patch: Partial<XlsxPageSetup>) {
    onChange({ pageSetup: { ...setup, ...patch } });
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1 py-1">
      <label className="inline-flex h-7 items-center gap-1.5 px-1 text-[11px] text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={protection?.enabled === true}
          onChange={(event) =>
            updateProtection({ enabled: event.currentTarget.checked })
          }
          className="h-3.5 w-3.5 accent-[var(--accent)]"
        />
        <Lock className="h-3.5 w-3.5" strokeWidth={1.75} />
        Protect
      </label>
      {protection?.enabled && (
        <>
          <label className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={protection.autoFilter === true}
              onChange={(event) =>
                updateProtection({ autoFilter: event.currentTarget.checked })
              }
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Filter
          </label>
          <label className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={protection.sort === true}
              onChange={(event) =>
                updateProtection({ sort: event.currentTarget.checked })
              }
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Sort
          </label>
        </>
      )}
      <div className="mx-1 h-5 w-px bg-[var(--border)]" />
      <Printer className="h-3.5 w-3.5 text-[var(--text-muted)]" strokeWidth={1.75} />
      <select
        value={setup.orientation ?? "portrait"}
        onChange={(event) =>
          updateSetup({
            orientation: event.currentTarget.value as XlsxPageSetup["orientation"],
          })
        }
        className="h-7 w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
        title="Print orientation"
      >
        <option value="portrait">Portrait</option>
        <option value="landscape">Landscape</option>
      </select>
      <label className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-[var(--text-muted)]">
        Scale
        <input
          type="number"
          min={10}
          max={400}
          step={5}
          value={setup.scale ?? 100}
          onChange={(event) => updateSetup({ scale: Number(event.target.value) })}
          className="h-6 w-12 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-right text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
      </label>
      <label className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-[var(--text-muted)]">
        Margin
        <input
          type="number"
          min={0}
          max={5}
          step={0.05}
          value={margins.left ?? 0.7}
          onChange={(event) => {
            const value = Number(event.target.value);
            updateMargins({ left: value, right: value });
          }}
          className="h-6 w-14 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-right text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title="Left and right margins"
        />
      </label>
      <label className="inline-flex h-7 items-center gap-1 px-1 text-[11px] text-[var(--text-muted)]">
        Top
        <input
          type="number"
          min={0}
          max={5}
          step={0.05}
          value={margins.top ?? 0.75}
          onChange={(event) => {
            const value = Number(event.target.value);
            updateMargins({ top: value, bottom: value });
          }}
          className="h-6 w-14 rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-right text-[var(--text)] outline-none focus:border-[var(--accent)]"
          title="Top and bottom margins"
        />
      </label>
    </div>
  );
}
