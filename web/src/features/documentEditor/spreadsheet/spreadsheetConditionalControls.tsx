import { PaintBucket } from "lucide-react";
import { cn } from "@/lib/utils";
import type { XlsxConditionalRule } from "../shared/models";

type XlsxConditionalRuleType = NonNullable<XlsxConditionalRule["type"]>;
type XlsxConditionalOperator = NonNullable<XlsxConditionalRule["operator"]>;

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
    const nextFormulas = patch.formulas ?? rule?.formulas ?? [""];
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
            formulas: rule?.formulas,
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
              ? "Formula"
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
