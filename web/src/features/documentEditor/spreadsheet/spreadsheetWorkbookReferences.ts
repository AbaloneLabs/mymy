import {
  invalidateSpreadsheetFormulaSheetReferences,
  renameSpreadsheetFormulaSheetReferences,
  transformSpreadsheetFormulaForStructuralEdit,
} from "./spreadsheetFormulaReferences";
import type { SpreadsheetStructuralEdit } from "./spreadsheetFormulaReferences";
import type {
  XlsxChart,
  XlsxDefinedName,
  XlsxModel,
  XlsxObjectAnchor,
  XlsxObjectMarker,
  XlsxSheet,
} from "../shared/models";

export interface XlsxSheetDeletionImpact {
  kind:
    | "cellFormula"
    | "dataValidation"
    | "conditionalFormatting"
    | "hyperlink"
    | "chartSeries"
    | "definedName";
  owner: string;
  formula: string;
}

/**
 * Workbook reference owners are updated together so a row or column action
 * cannot move cells while leaving formulas, drawing anchors, or local names at
 * the old coordinates. Metadata range ownership that already has specialized
 * split/shift rules remains in `spreadsheetXlsxMetadata`; this module owns the
 * cross-sheet and formula-bearing layer.
 */
export function transformXlsxWorkbookReferencesForStructureEdit(
  model: XlsxModel,
  targetSheetId: string,
  edit: SpreadsheetStructuralEdit,
): XlsxModel {
  const targetSheet = model.sheets.find((sheet) => sheet.id === targetSheetId);
  if (!targetSheet) return model;
  const targetSheetName = targetSheet.name;
  return {
    sheets: model.sheets.map((sheet) =>
      transformSheetStructureReferences(
        sheet,
        targetSheetId,
        targetSheetName,
        edit,
      ),
    ),
    definedNames: transformDefinedNamesForStructureEdit(
      model.definedNames,
      model.sheets,
      targetSheetName,
      edit,
    ),
  };
}

export function renameXlsxWorkbookSheetReferences(
  model: XlsxModel,
  oldName: string,
  nextName: string,
): XlsxModel {
  return {
    sheets: model.sheets.map((sheet) => ({
      ...sheet,
      rows: sheet.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({
          ...cell,
          formula: renameOptionalFormula(cell.formula, oldName, nextName),
        })),
      })),
      dataValidations: sheet.dataValidations?.map((validation) => ({
        ...validation,
        formula1: renameOptionalFormula(validation.formula1, oldName, nextName),
        formula2: renameOptionalFormula(validation.formula2, oldName, nextName),
      })),
      conditionalFormattings: sheet.conditionalFormattings?.map(
        (formatting) => ({
          ...formatting,
          rules: formatting.rules.map((rule) => ({
            ...rule,
            formulas: rule.formulas?.map((formula) =>
              renameSpreadsheetFormulaSheetReferences(
                formula,
                oldName,
                nextName,
              ),
            ),
          })),
        }),
      ),
      hyperlinks: sheet.hyperlinks?.map((hyperlink) => ({
        ...hyperlink,
        location: renameOptionalFormula(hyperlink.location, oldName, nextName),
      })),
      charts: sheet.charts?.map((chart) =>
        renameChartReferences(chart, oldName, nextName),
      ),
    })),
    definedNames: model.definedNames?.map((definedName) => ({
      ...definedName,
      sourceXml: undefined,
      value: renameSpreadsheetFormulaSheetReferences(
        definedName.value,
        oldName,
        nextName,
      ),
    })),
  };
}

export function analyzeXlsxSheetDeletion(
  model: XlsxModel,
  deletedSheetId: string,
) {
  const deletedSheet = model.sheets.find((sheet) => sheet.id === deletedSheetId);
  if (!deletedSheet) return [];
  const impacts: XlsxSheetDeletionImpact[] = [];
  const inspect = (
    kind: XlsxSheetDeletionImpact["kind"],
    owner: string,
    formula: string | undefined,
  ) => {
    if (
      formula &&
      invalidateSpreadsheetFormulaSheetReferences(formula, deletedSheet.name) !== formula
    ) {
      impacts.push({ kind, owner, formula });
    }
  };
  for (const sheet of model.sheets) {
    if (sheet.id === deletedSheetId) continue;
    for (const row of sheet.rows) {
      for (const cell of row.cells) {
        inspect("cellFormula", `${sheet.name}!${cell.ref}`, cell.formula);
      }
    }
    sheet.dataValidations?.forEach((validation, index) => {
      inspect(
        "dataValidation",
        `${sheet.name} validation ${index + 1}`,
        validation.formula1,
      );
      inspect(
        "dataValidation",
        `${sheet.name} validation ${index + 1}`,
        validation.formula2,
      );
    });
    sheet.conditionalFormattings?.forEach((formatting, formattingIndex) =>
      formatting.rules.forEach((rule, ruleIndex) =>
        rule.formulas?.forEach((formula) =>
          inspect(
            "conditionalFormatting",
            `${sheet.name} conditional rule ${formattingIndex + 1}.${ruleIndex + 1}`,
            formula,
          ),
        ),
      ),
    );
    sheet.hyperlinks?.forEach((hyperlink) =>
      inspect("hyperlink", `${sheet.name}!${hyperlink.ref}`, hyperlink.location),
    );
    sheet.charts?.forEach((chart, chartIndex) =>
      chart.series?.forEach((series, seriesIndex) => {
        const owner = `${sheet.name} chart ${chartIndex + 1} series ${seriesIndex + 1}`;
        inspect("chartSeries", owner, series.nameFormula);
        inspect("chartSeries", owner, series.categoriesFormula);
        inspect("chartSeries", owner, series.valuesFormula);
      }),
    );
  }
  model.definedNames?.forEach((definedName) =>
    inspect("definedName", `Defined name ${definedName.name}`, definedName.value),
  );
  return impacts;
}

export function invalidateXlsxWorkbookSheetReferences(
  model: XlsxModel,
  deletedSheetName: string,
): XlsxModel {
  const invalidate = (formula: string | undefined) =>
    formula
      ? invalidateSpreadsheetFormulaSheetReferences(formula, deletedSheetName)
      : undefined;
  return {
    sheets: model.sheets.map((sheet) => ({
      ...sheet,
      rows: sheet.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({
          ...cell,
          formula: invalidate(cell.formula),
        })),
      })),
      dataValidations: sheet.dataValidations?.map((validation) => ({
        ...validation,
        formula1: invalidate(validation.formula1),
        formula2: invalidate(validation.formula2),
      })),
      conditionalFormattings: sheet.conditionalFormattings?.map(
        (formatting) => ({
          ...formatting,
          rules: formatting.rules.map((rule) => ({
            ...rule,
            formulas: rule.formulas?.map((formula) => invalidate(formula) ?? formula),
          })),
        }),
      ),
      hyperlinks: sheet.hyperlinks?.map((hyperlink) => ({
        ...hyperlink,
        location: invalidate(hyperlink.location),
      })),
      charts: sheet.charts?.map((chart) =>
        transformChartReferences(chart, (formula) => invalidate(formula) ?? formula),
      ),
    })),
    definedNames: model.definedNames?.map((definedName) => ({
      ...definedName,
      value: invalidate(definedName.value) ?? definedName.value,
      sourceXml: undefined,
    })),
  };
}

function transformSheetStructureReferences(
  sheet: XlsxSheet,
  targetSheetId: string,
  targetSheetName: string,
  edit: SpreadsheetStructuralEdit,
): XlsxSheet {
  const isTarget = sheet.id === targetSheetId;
  const transform = (formula: string) =>
    transformSpreadsheetFormulaForStructuralEdit(
      formula,
      sheet.name,
      targetSheetName,
      edit,
    );
  return {
    ...sheet,
    rows: sheet.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => ({
        ...cell,
        formula: cell.formula ? transform(cell.formula) : undefined,
        formulaRef:
          isTarget && cell.formulaRef
            ? transform(cell.formulaRef)
            : cell.formulaRef,
        spillParent:
          isTarget && cell.spillParent
            ? transform(cell.spillParent)
            : cell.spillParent,
        spillRange:
          isTarget && cell.spillRange
            ? transform(cell.spillRange)
            : cell.spillRange,
      })),
    })),
    mergedRanges: isTarget
      ? sheet.mergedRanges
          ?.map((range) => ({ ...range, ref: transform(range.ref) }))
          .filter((range) => !range.ref.includes("#REF!"))
      : sheet.mergedRanges,
    dataValidations: sheet.dataValidations?.map((validation) => ({
      ...validation,
      formula1: validation.formula1
        ? transform(validation.formula1)
        : undefined,
      formula2: validation.formula2
        ? transform(validation.formula2)
        : undefined,
    })),
    conditionalFormattings: sheet.conditionalFormattings?.map((formatting) => ({
      ...formatting,
      rules: formatting.rules.map((rule) => ({
        ...rule,
        formulas: rule.formulas?.map(transform),
      })),
    })),
    hyperlinks: sheet.hyperlinks?.map((hyperlink) => ({
      ...hyperlink,
      location: hyperlink.location ? transform(hyperlink.location) : undefined,
    })),
    charts: sheet.charts?.map((chart) => ({
      ...transformChartReferences(chart, transform),
      anchor: isTarget
        ? transformObjectAnchor(chart.anchor, edit)
        : chart.anchor,
    })),
    images: sheet.images?.map((image) => ({
      ...image,
      anchor: isTarget
        ? transformObjectAnchor(image.anchor, edit)
        : image.anchor,
    })),
  };
}

function transformDefinedNamesForStructureEdit(
  definedNames: XlsxDefinedName[] | undefined,
  sheets: XlsxSheet[],
  targetSheetName: string,
  edit: SpreadsheetStructuralEdit,
) {
  return definedNames?.map((definedName) => {
    const formulaSheetName =
      definedName.localSheetId === undefined
        ? "\0workbook-scope"
        : (sheets[definedName.localSheetId]?.name ?? "\0missing-sheet");
    const value = transformSpreadsheetFormulaForStructuralEdit(
      definedName.value,
      formulaSheetName,
      targetSheetName,
      edit,
    );
    return value === definedName.value
      ? definedName
      : { ...definedName, value, sourceXml: undefined };
  });
}

function transformChartReferences(
  chart: XlsxChart,
  transform: (formula: string) => string,
): XlsxChart {
  return {
    ...chart,
    series: chart.series?.map((series) => ({
      ...series,
      nameFormula: series.nameFormula
        ? transform(series.nameFormula)
        : undefined,
      categoriesFormula: series.categoriesFormula
        ? transform(series.categoriesFormula)
        : undefined,
      valuesFormula: series.valuesFormula
        ? transform(series.valuesFormula)
        : undefined,
    })),
  };
}

function renameChartReferences(
  chart: XlsxChart,
  oldName: string,
  nextName: string,
) {
  return transformChartReferences(chart, (formula) =>
    renameSpreadsheetFormulaSheetReferences(formula, oldName, nextName),
  );
}

function transformObjectAnchor(
  anchor: XlsxObjectAnchor | undefined,
  edit: SpreadsheetStructuralEdit,
) {
  if (!anchor) return undefined;
  return {
    from: transformObjectMarker(anchor.from, edit),
    to: transformObjectMarker(anchor.to, edit),
  };
}

function transformObjectMarker(
  marker: XlsxObjectMarker | undefined,
  edit: SpreadsheetStructuralEdit,
) {
  if (!marker) return undefined;
  const key = edit.axis;
  const coordinate = marker[key];
  if (coordinate === undefined) return { ...marker };
  const nextCoordinate =
    edit.kind === "insert"
      ? coordinate >= edit.index
        ? coordinate + 1
        : coordinate
      : coordinate > edit.index
        ? coordinate - 1
        : coordinate;
  return { ...marker, [key]: nextCoordinate };
}

function renameOptionalFormula(
  formula: string | undefined,
  oldName: string,
  nextName: string,
) {
  return formula
    ? renameSpreadsheetFormulaSheetReferences(formula, oldName, nextName)
    : undefined;
}
