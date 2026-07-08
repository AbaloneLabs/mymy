import type { XlsxChart, XlsxChartSeries } from "../../shared/models";
import { isRecord, numericField } from "../shared";
import { normalizeXlsxObjectAnchor } from "./objects";

export function normalizeXlsxChart(value: unknown): XlsxChart | null {
  const item = isRecord(value) ? value : {};
  if (typeof item.id !== "string") return null;
  return {
    id: item.id,
    path: typeof item.path === "string" ? item.path : undefined,
    type: typeof item.type === "string" ? item.type : undefined,
    title: typeof item.title === "string" ? item.title : undefined,
    legendVisible:
      typeof item.legendVisible === "boolean" ? item.legendVisible : undefined,
    legendPosition: xlsxChartLegendPosition(item.legendPosition),
    categoryAxisTitle:
      typeof item.categoryAxisTitle === "string"
        ? item.categoryAxisTitle
        : undefined,
    valueAxisTitle:
      typeof item.valueAxisTitle === "string" ? item.valueAxisTitle : undefined,
    categoryAxisPosition: xlsxChartCategoryAxisPosition(
      item.categoryAxisPosition,
    ),
    valueAxisPosition: xlsxChartValueAxisPosition(item.valueAxisPosition),
    categoryMajorGridlines:
      typeof item.categoryMajorGridlines === "boolean"
        ? item.categoryMajorGridlines
        : undefined,
    valueMajorGridlines:
      typeof item.valueMajorGridlines === "boolean"
        ? item.valueMajorGridlines
        : undefined,
    categoryAxisTickLabelPosition: xlsxChartTickLabelPosition(
      item.categoryAxisTickLabelPosition,
    ),
    valueAxisTickLabelPosition: xlsxChartTickLabelPosition(
      item.valueAxisTickLabelPosition,
    ),
    categoryAxisMajorTickMark: xlsxChartTickMark(
      item.categoryAxisMajorTickMark,
    ),
    valueAxisMajorTickMark: xlsxChartTickMark(item.valueAxisMajorTickMark),
    categoryAxisMinorTickMark: xlsxChartTickMark(
      item.categoryAxisMinorTickMark,
    ),
    valueAxisMinorTickMark: xlsxChartTickMark(item.valueAxisMinorTickMark),
    categoryAxisNumberFormat:
      typeof item.categoryAxisNumberFormat === "string"
        ? item.categoryAxisNumberFormat
        : undefined,
    valueAxisNumberFormat:
      typeof item.valueAxisNumberFormat === "string"
        ? item.valueAxisNumberFormat
        : undefined,
    categoryAxisLineColor:
      typeof item.categoryAxisLineColor === "string"
        ? item.categoryAxisLineColor
        : undefined,
    valueAxisLineColor:
      typeof item.valueAxisLineColor === "string"
        ? item.valueAxisLineColor
        : undefined,
    categoryAxisLineWidth: numericField(item.categoryAxisLineWidth),
    valueAxisLineWidth: numericField(item.valueAxisLineWidth),
    categoryAxisLineDash: xlsxChartLineDash(item.categoryAxisLineDash),
    valueAxisLineDash: xlsxChartLineDash(item.valueAxisLineDash),
    categoryAxisLabelTextColor:
      typeof item.categoryAxisLabelTextColor === "string"
        ? item.categoryAxisLabelTextColor
        : undefined,
    valueAxisLabelTextColor:
      typeof item.valueAxisLabelTextColor === "string"
        ? item.valueAxisLabelTextColor
        : undefined,
    categoryAxisLabelFontSize: numericField(item.categoryAxisLabelFontSize),
    valueAxisLabelFontSize: numericField(item.valueAxisLabelFontSize),
    categoryAxisLabelRotation: numericField(item.categoryAxisLabelRotation),
    valueAxisLabelRotation: numericField(item.valueAxisLabelRotation),
    categoryAxisLabelBold:
      typeof item.categoryAxisLabelBold === "boolean"
        ? item.categoryAxisLabelBold
        : undefined,
    valueAxisLabelBold:
      typeof item.valueAxisLabelBold === "boolean"
        ? item.valueAxisLabelBold
        : undefined,
    categoryAxisLabelItalic:
      typeof item.categoryAxisLabelItalic === "boolean"
        ? item.categoryAxisLabelItalic
        : undefined,
    valueAxisLabelItalic:
      typeof item.valueAxisLabelItalic === "boolean"
        ? item.valueAxisLabelItalic
        : undefined,
    categories: normalizeChartStringList(item.categories),
    series: Array.isArray(item.series)
      ? item.series
          .map((series) => normalizeXlsxChartSeries(series))
          .filter((series): series is XlsxChartSeries => series !== null)
      : undefined,
    anchor: normalizeXlsxObjectAnchor(item.anchor),
  };
}

function xlsxChartLegendPosition(
  value: unknown,
): XlsxChart["legendPosition"] | undefined {
  return value === "r" ||
    value === "l" ||
    value === "t" ||
    value === "b" ||
    value === "tr"
    ? value
    : undefined;
}

function xlsxChartCategoryAxisPosition(
  value: unknown,
): XlsxChart["categoryAxisPosition"] | undefined {
  return value === "b" || value === "t" ? value : undefined;
}

function xlsxChartValueAxisPosition(
  value: unknown,
): XlsxChart["valueAxisPosition"] | undefined {
  return value === "l" || value === "r" ? value : undefined;
}

function xlsxChartTickLabelPosition(
  value: unknown,
): XlsxChart["categoryAxisTickLabelPosition"] | undefined {
  return value === "nextTo" ||
    value === "low" ||
    value === "high" ||
    value === "none"
    ? value
    : undefined;
}

function xlsxChartTickMark(
  value: unknown,
): XlsxChart["categoryAxisMajorTickMark"] | undefined {
  return value === "cross" || value === "in" || value === "out" || value === "none"
    ? value
    : undefined;
}

function xlsxChartLineDash(
  value: unknown,
): XlsxChart["categoryAxisLineDash"] | undefined {
  return value === "solid" ||
    value === "dash" ||
    value === "dot" ||
    value === "dashDot"
    ? value
    : undefined;
}

function normalizeXlsxChartSeries(value: unknown): XlsxChartSeries | null {
  const item = isRecord(value) ? value : {};
  const series: XlsxChartSeries = {
    name: typeof item.name === "string" ? item.name : undefined,
    nameFormula:
      typeof item.nameFormula === "string" ? item.nameFormula : undefined,
    categories: normalizeChartStringList(item.categories),
    categoriesFormula:
      typeof item.categoriesFormula === "string"
        ? item.categoriesFormula
        : undefined,
    values: normalizeChartStringList(item.values),
    valuesFormula:
      typeof item.valuesFormula === "string" ? item.valuesFormula : undefined,
  };
  return Object.values(series).some((field) => field !== undefined)
    ? series
    : null;
}

function normalizeChartStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) =>
    typeof item === "string" ? item : String(item ?? ""),
  );
}
