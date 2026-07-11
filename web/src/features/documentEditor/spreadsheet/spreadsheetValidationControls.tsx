import type { XlsxDataValidation } from "../shared/models";

type XlsxDataValidationType = NonNullable<XlsxDataValidation["type"]>;
type XlsxDataValidationOperator = NonNullable<XlsxDataValidation["operator"]>;

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
  { label: "Custom formula (preserve only)", value: "custom" },
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
            formula1: validation?.formula1,
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
              ? "List values or range"
              : type === "custom"
                ? "Formula"
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
            Enforce
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
