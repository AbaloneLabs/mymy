import type {
  XlsxComment,
  XlsxConditionalFormatting,
  XlsxConditionalRule,
  XlsxDataValidation,
  XlsxHyperlink,
} from "../../shared/models";
import { isRecord, numericField } from "../shared";

export function normalizeXlsxDataValidation(value: unknown): XlsxDataValidation | null {
  const item = isRecord(value) ? value : {};
  if (typeof item.sqref !== "string" || item.sqref.trim() === "") {
    return null;
  }
  return {
    sqref: item.sqref,
    type:
      item.type === "whole" ||
      item.type === "decimal" ||
      item.type === "list" ||
      item.type === "date" ||
      item.type === "time" ||
      item.type === "textLength" ||
      item.type === "custom"
        ? item.type
        : undefined,
    operator:
      item.operator === "between" ||
      item.operator === "notBetween" ||
      item.operator === "equal" ||
      item.operator === "notEqual" ||
      item.operator === "greaterThan" ||
      item.operator === "lessThan" ||
      item.operator === "greaterThanOrEqual" ||
      item.operator === "lessThanOrEqual"
        ? item.operator
        : undefined,
    formula1: typeof item.formula1 === "string" ? item.formula1 : undefined,
    formula2: typeof item.formula2 === "string" ? item.formula2 : undefined,
    allowBlank: item.allowBlank === true,
    showInputMessage: item.showInputMessage === true,
    showErrorMessage: item.showErrorMessage === true,
    promptTitle:
      typeof item.promptTitle === "string" ? item.promptTitle : undefined,
    prompt: typeof item.prompt === "string" ? item.prompt : undefined,
    errorTitle:
      typeof item.errorTitle === "string" ? item.errorTitle : undefined,
    error: typeof item.error === "string" ? item.error : undefined,
  };
}

export function normalizeXlsxConditionalFormatting(
  value: unknown,
): XlsxConditionalFormatting | null {
  const item = isRecord(value) ? value : {};
  if (typeof item.sqref !== "string" || item.sqref.trim() === "") {
    return null;
  }
  const rules = Array.isArray(item.rules)
    ? item.rules
        .map((rule) => normalizeXlsxConditionalRule(rule))
        .filter((rule): rule is XlsxConditionalRule => rule !== null)
    : [];
  if (rules.length === 0) return null;
  return {
    sqref: item.sqref,
    rules,
  };
}

function normalizeXlsxConditionalRule(
  value: unknown,
): XlsxConditionalRule | null {
  const item = isRecord(value) ? value : {};
  const type = normalizeXlsxConditionalRuleType(item.type);
  const sourceXml =
    typeof item.sourceXml === "string" ? item.sourceXml : undefined;
  if (!type && !sourceXml) return null;
  return {
    type,
    operator: normalizeXlsxConditionalOperator(item.operator),
    priority: numericField(item.priority),
    dxfId: numericField(item.dxfId),
    fillColor:
      typeof item.fillColor === "string" ? item.fillColor : undefined,
    text: typeof item.text === "string" ? item.text : undefined,
    timePeriod:
      typeof item.timePeriod === "string" ? item.timePeriod : undefined,
    formulas: Array.isArray(item.formulas)
      ? item.formulas
          .map((formula) => (typeof formula === "string" ? formula : null))
          .filter((formula): formula is string => formula !== null)
      : undefined,
    sourceXml,
  };
}

function normalizeXlsxConditionalRuleType(
  value: unknown,
): XlsxConditionalRule["type"] {
  return value === "cellIs" ||
    value === "expression" ||
    value === "colorScale" ||
    value === "dataBar" ||
    value === "iconSet" ||
    value === "top10" ||
    value === "uniqueValues" ||
    value === "duplicateValues" ||
    value === "containsText" ||
    value === "notContainsText" ||
    value === "beginsWith" ||
    value === "endsWith" ||
    value === "aboveAverage" ||
    value === "timePeriod" ||
    value === "blanks" ||
    value === "notBlanks" ||
    value === "errors" ||
    value === "notErrors"
    ? value
    : undefined;
}

function normalizeXlsxConditionalOperator(
  value: unknown,
): XlsxConditionalRule["operator"] {
  return value === "lessThan" ||
    value === "lessThanOrEqual" ||
    value === "equal" ||
    value === "notEqual" ||
    value === "greaterThanOrEqual" ||
    value === "greaterThan" ||
    value === "between" ||
    value === "notBetween" ||
    value === "containsText" ||
    value === "notContains" ||
    value === "beginsWith" ||
    value === "endsWith"
    ? value
    : undefined;
}

export function normalizeXlsxHyperlink(value: unknown): XlsxHyperlink | null {
  const item = isRecord(value) ? value : {};
  if (typeof item.ref !== "string" || item.ref.trim() === "") return null;
  const target = typeof item.target === "string" ? item.target : undefined;
  const location =
    typeof item.location === "string" ? item.location : undefined;
  if (!target && !location) return null;
  return {
    ref: item.ref,
    relationshipId:
      typeof item.relationshipId === "string"
        ? item.relationshipId
        : undefined,
    target,
    location,
    display: typeof item.display === "string" ? item.display : undefined,
    tooltip: typeof item.tooltip === "string" ? item.tooltip : undefined,
  };
}

export function normalizeXlsxComment(value: unknown): XlsxComment | null {
  const item = isRecord(value) ? value : {};
  if (
    typeof item.ref !== "string" ||
    item.ref.trim() === "" ||
    typeof item.text !== "string"
  ) {
    return null;
  }
  return {
    ref: item.ref,
    author: typeof item.author === "string" ? item.author : undefined,
    text: item.text,
    authorId: numericField(item.authorId),
  };
}
