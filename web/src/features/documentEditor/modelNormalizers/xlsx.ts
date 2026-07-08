import type {
  XlsxChart,
  XlsxChartSeries,
  XlsxComment,
  XlsxConditionalFormatting,
  XlsxConditionalRule,
  XlsxColumn,
  XlsxDataValidation,
  XlsxDefinedName,
  XlsxHyperlink,
  XlsxImage,
  XlsxMergedRange,
  XlsxModel,
  XlsxObjectAnchor,
  XlsxObjectMarker,
  XlsxPageMargins,
  XlsxPageSetup,
  XlsxPivot,
  XlsxPivotDataField,
  XlsxPivotField,
  XlsxSheetProtection,
  XlsxTable,
  XlsxTableColumn,
} from "../models";
import { columnName, isRecord, numericField } from "./shared";

export function normalizeXlsxModel(model: unknown): XlsxModel {
  if (!isRecord(model) || !Array.isArray(model.sheets)) return { sheets: [] };
  return {
    definedNames: Array.isArray(model.definedNames)
      ? model.definedNames
          .map((definedName) => normalizeXlsxDefinedName(definedName))
          .filter(
            (definedName): definedName is XlsxDefinedName =>
              definedName !== null,
          )
      : undefined,
    sheets: model.sheets.map((sheet, sheetIndex) => {
      const item = isRecord(sheet) ? sheet : {};
      const rows = Array.isArray(item.rows) ? item.rows : [];
      return {
        id: typeof item.id === "string" ? item.id : `sheet${sheetIndex + 1}`,
        name:
          typeof item.name === "string" ? item.name : `sheet-${sheetIndex + 1}`,
        state:
          item.state === "hidden" || item.state === "veryHidden"
            ? item.state
            : "visible",
        tabColor:
          typeof item.tabColor === "string" ? item.tabColor : undefined,
        tabColorSourceXml:
          typeof item.tabColorSourceXml === "string"
            ? item.tabColorSourceXml
            : undefined,
        columns: Array.isArray(item.columns)
          ? item.columns
              .map((column): XlsxColumn | null => {
                const columnItem = isRecord(column) ? column : {};
                const index =
                  typeof columnItem.index === "number" &&
                  Number.isFinite(columnItem.index)
                    ? columnItem.index
                    : null;
                if (index === null) return null;
                const normalized: XlsxColumn = {
                  index: Math.max(0, Math.floor(index)),
                  hidden: columnItem.hidden === true,
                };
                const width = numericField(columnItem.width);
                if (width !== undefined) {
                  normalized.width = width;
                }
                return normalized;
              })
              .filter((column): column is XlsxColumn => column !== null)
          : undefined,
        mergedRanges: Array.isArray(item.mergedRanges)
          ? item.mergedRanges
              .map((range) => {
                const rangeItem = isRecord(range) ? range : {};
                return typeof rangeItem.ref === "string"
                  ? { ref: rangeItem.ref }
                  : null;
              })
              .filter((range): range is XlsxMergedRange => Boolean(range))
          : undefined,
        dataValidations: Array.isArray(item.dataValidations)
          ? item.dataValidations
              .map((validation) => normalizeXlsxDataValidation(validation))
              .filter(
                (validation): validation is XlsxDataValidation =>
                  validation !== null,
              )
          : undefined,
        conditionalFormattings: Array.isArray(item.conditionalFormattings)
          ? item.conditionalFormattings
              .map((formatting) => normalizeXlsxConditionalFormatting(formatting))
              .filter(
                (
                  formatting,
                ): formatting is XlsxConditionalFormatting =>
                  formatting !== null,
              )
          : undefined,
        hyperlinks: Array.isArray(item.hyperlinks)
          ? item.hyperlinks
              .map((hyperlink) => normalizeXlsxHyperlink(hyperlink))
              .filter(
                (hyperlink): hyperlink is XlsxHyperlink =>
                  hyperlink !== null,
              )
          : undefined,
        comments: Array.isArray(item.comments)
          ? item.comments
              .map((comment) => normalizeXlsxComment(comment))
              .filter((comment): comment is XlsxComment => comment !== null)
          : undefined,
        tables: Array.isArray(item.tables)
          ? item.tables
              .map((table) => normalizeXlsxTable(table))
              .filter((table): table is XlsxTable => table !== null)
          : undefined,
        charts: Array.isArray(item.charts)
          ? item.charts
              .map((chart) => normalizeXlsxChart(chart))
              .filter((chart): chart is XlsxChart => chart !== null)
          : undefined,
        images: Array.isArray(item.images)
          ? item.images
              .map((image) => normalizeXlsxImage(image))
              .filter((image): image is XlsxImage => image !== null)
          : undefined,
        pivots: Array.isArray(item.pivots)
          ? item.pivots
              .map((pivot) => normalizeXlsxPivot(pivot))
              .filter((pivot): pivot is XlsxPivot => pivot !== null)
          : undefined,
        protection: normalizeXlsxSheetProtection(item.protection),
        pageMargins: normalizeXlsxPageMargins(item.pageMargins),
        pageSetup: normalizeXlsxPageSetup(item.pageSetup),
        autoFilter:
          typeof item.autoFilter === "string" ? item.autoFilter : undefined,
        frozenRows: numericField(item.frozenRows),
        frozenColumns: numericField(item.frozenColumns),
        rows: rows.map((row, rowIndex) => {
          const rowItem = isRecord(row) ? row : {};
          const cells = Array.isArray(rowItem.cells) ? rowItem.cells : [];
          return {
            index:
              typeof rowItem.index === "string"
                ? rowItem.index
                : String(rowIndex + 1),
            height: numericField(rowItem.height),
            hidden: rowItem.hidden === true,
            cells: cells.map((cell, cellIndex) => {
              const cellItem = isRecord(cell) ? cell : {};
              return {
                ref:
                  typeof cellItem.ref === "string"
                    ? cellItem.ref
                    : `${columnName(cellIndex)}${rowIndex + 1}`,
                value:
                  typeof cellItem.value === "string" ? cellItem.value : "",
                formula:
                  typeof cellItem.formula === "string"
                    ? cellItem.formula
                    : undefined,
                generated: cellItem.generated === "spill" ? "spill" : undefined,
                spillParent:
                  typeof cellItem.spillParent === "string"
                    ? cellItem.spillParent
                    : undefined,
                spillRange:
                  typeof cellItem.spillRange === "string"
                    ? cellItem.spillRange
                    : undefined,
                numberFormat:
                  typeof cellItem.numberFormat === "string"
                    ? cellItem.numberFormat
                    : undefined,
                fontFamily:
                  typeof cellItem.fontFamily === "string"
                    ? cellItem.fontFamily
                    : undefined,
                fontSize:
                  typeof cellItem.fontSize === "string"
                    ? cellItem.fontSize
                    : undefined,
                bold: cellItem.bold === true,
                italic: cellItem.italic === true,
                underline: cellItem.underline === true,
                strikethrough: cellItem.strikethrough === true,
                color:
                  typeof cellItem.color === "string" ? cellItem.color : undefined,
                fillColor:
                  typeof cellItem.fillColor === "string"
                    ? cellItem.fillColor
                    : undefined,
                align:
                  cellItem.align === "left" ||
                  cellItem.align === "center" ||
                  cellItem.align === "right"
                    ? cellItem.align
                    : undefined,
                verticalAlign:
                  cellItem.verticalAlign === "top" ||
                  cellItem.verticalAlign === "middle" ||
                  cellItem.verticalAlign === "bottom"
                    ? cellItem.verticalAlign
                    : undefined,
                wrapText: cellItem.wrapText === true,
              };
            }),
          };
        }),
      };
    }),
  };
}

function normalizeXlsxDefinedName(value: unknown): XlsxDefinedName | null {
  const item = isRecord(value) ? value : {};
  if (typeof item.name !== "string" || item.name.trim() === "") return null;
  return {
    name: item.name,
    value: typeof item.value === "string" ? item.value : "",
    localSheetId: numericField(item.localSheetId),
    hidden: item.hidden === true,
    comment: typeof item.comment === "string" ? item.comment : undefined,
    sourceXml: typeof item.sourceXml === "string" ? item.sourceXml : undefined,
  };
}

function normalizeXlsxDataValidation(value: unknown): XlsxDataValidation | null {
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

function normalizeXlsxConditionalFormatting(
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

function normalizeXlsxHyperlink(value: unknown): XlsxHyperlink | null {
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

function normalizeXlsxComment(value: unknown): XlsxComment | null {
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

function normalizeXlsxChart(value: unknown): XlsxChart | null {
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

function normalizeXlsxTable(value: unknown): XlsxTable | null {
  const item = isRecord(value) ? value : {};
  if (typeof item.id !== "string") return null;
  return {
    id: item.id,
    path: typeof item.path === "string" ? item.path : undefined,
    name: typeof item.name === "string" ? item.name : undefined,
    displayName:
      typeof item.displayName === "string" ? item.displayName : undefined,
    ref: typeof item.ref === "string" ? item.ref : undefined,
    autoFilterRef:
      typeof item.autoFilterRef === "string" ? item.autoFilterRef : undefined,
    totalsRowShown:
      typeof item.totalsRowShown === "boolean" ? item.totalsRowShown : undefined,
    tableStyleName:
      typeof item.tableStyleName === "string" ? item.tableStyleName : undefined,
    showFirstColumn:
      typeof item.showFirstColumn === "boolean" ? item.showFirstColumn : undefined,
    showLastColumn:
      typeof item.showLastColumn === "boolean" ? item.showLastColumn : undefined,
    showRowStripes:
      typeof item.showRowStripes === "boolean" ? item.showRowStripes : undefined,
    showColumnStripes:
      typeof item.showColumnStripes === "boolean" ? item.showColumnStripes : undefined,
    columns: Array.isArray(item.columns)
      ? item.columns
          .map((column) => normalizeXlsxTableColumn(column))
          .filter((column): column is XlsxTableColumn => column !== null)
      : undefined,
  };
}

function normalizeXlsxTableColumn(value: unknown): XlsxTableColumn | null {
  const item = isRecord(value) ? value : {};
  const id =
    typeof item.id === "string"
      ? item.id
      : typeof item.id === "number" && Number.isFinite(item.id)
        ? String(item.id)
        : undefined;
  const name = typeof item.name === "string" ? item.name : undefined;
  const totalsRowFunction =
    typeof item.totalsRowFunction === "string"
      ? item.totalsRowFunction
      : undefined;
  if (!id && !name && !totalsRowFunction) return null;
  return { id, name, totalsRowFunction };
}

function normalizeXlsxImage(value: unknown): XlsxImage | null {
  const item = isRecord(value) ? value : {};
  if (typeof item.id !== "string") return null;
  return {
    id: item.id,
    drawingPath:
      typeof item.drawingPath === "string" ? item.drawingPath : undefined,
    mediaPath: typeof item.mediaPath === "string" ? item.mediaPath : undefined,
    mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
    dataUrl: typeof item.dataUrl === "string" ? item.dataUrl : undefined,
    anchor: normalizeXlsxObjectAnchor(item.anchor),
  };
}

function normalizeXlsxPivot(value: unknown): XlsxPivot | null {
  const item = isRecord(value) ? value : {};
  if (typeof item.id !== "string") return null;
  return {
    id: item.id,
    path: typeof item.path === "string" ? item.path : undefined,
    name: typeof item.name === "string" ? item.name : undefined,
    cacheId: typeof item.cacheId === "string" ? item.cacheId : undefined,
    fields: Array.isArray(item.fields)
      ? item.fields
          .map((field) => normalizeXlsxPivotField(field))
          .filter((field): field is XlsxPivotField => field !== null)
      : undefined,
    dataFields: Array.isArray(item.dataFields)
      ? item.dataFields
          .map((field) => normalizeXlsxPivotDataField(field))
          .filter((field): field is XlsxPivotDataField => field !== null)
      : undefined,
  };
}

function normalizeXlsxPivotField(value: unknown): XlsxPivotField | null {
  const item = isRecord(value) ? value : {};
  const index = numericField(item.index);
  if (index === undefined) return null;
  const axis =
    item.axis === "axisRow" ||
    item.axis === "axisCol" ||
    item.axis === "axisPage" ||
    item.axis === "axisValues"
      ? item.axis
      : undefined;
  return {
    index: Math.max(0, Math.floor(index)),
    name: typeof item.name === "string" ? item.name : undefined,
    axis,
    dataField: typeof item.dataField === "boolean" ? item.dataField : undefined,
    showAll: typeof item.showAll === "boolean" ? item.showAll : undefined,
    defaultSubtotal:
      typeof item.defaultSubtotal === "boolean"
        ? item.defaultSubtotal
        : undefined,
    subtotal: typeof item.subtotal === "string" ? item.subtotal : undefined,
  };
}

function normalizeXlsxPivotDataField(
  value: unknown,
): XlsxPivotDataField | null {
  const item = isRecord(value) ? value : {};
  const fieldIndex = numericField(item.fieldIndex);
  if (fieldIndex === undefined) return null;
  return {
    fieldIndex: Math.max(0, Math.floor(fieldIndex)),
    name: typeof item.name === "string" ? item.name : undefined,
    subtotal: typeof item.subtotal === "string" ? item.subtotal : undefined,
  };
}

function normalizeXlsxObjectAnchor(value: unknown): XlsxObjectAnchor | undefined {
  if (!isRecord(value)) return undefined;
  const anchor = {
    from: normalizeXlsxObjectMarker(value.from),
    to: normalizeXlsxObjectMarker(value.to),
  };
  return anchor.from || anchor.to ? anchor : undefined;
}

function normalizeXlsxObjectMarker(value: unknown): XlsxObjectMarker | undefined {
  if (!isRecord(value)) return undefined;
  const marker = {
    column: numericField(value.column),
    columnOffset: numericField(value.columnOffset),
    row: numericField(value.row),
    rowOffset: numericField(value.rowOffset),
  };
  return Object.values(marker).some((item) => item !== undefined)
    ? marker
    : undefined;
}

function normalizeXlsxSheetProtection(
  value: unknown,
): XlsxSheetProtection | undefined {
  const item = isRecord(value) ? value : {};
  if (item.enabled !== true) return undefined;
  return {
    enabled: true,
    password: typeof item.password === "string" ? item.password : undefined,
    objects: item.objects === true,
    scenarios: item.scenarios === true,
    formatCells: item.formatCells === true,
    formatColumns: item.formatColumns === true,
    formatRows: item.formatRows === true,
    insertColumns: item.insertColumns === true,
    insertRows: item.insertRows === true,
    insertHyperlinks: item.insertHyperlinks === true,
    deleteColumns: item.deleteColumns === true,
    deleteRows: item.deleteRows === true,
    sort: item.sort === true,
    autoFilter: item.autoFilter === true,
    pivotTables: item.pivotTables === true,
  };
}

function normalizeXlsxPageMargins(value: unknown): XlsxPageMargins | undefined {
  const item = isRecord(value) ? value : {};
  const margins: XlsxPageMargins = {
    left: numericField(item.left),
    right: numericField(item.right),
    top: numericField(item.top),
    bottom: numericField(item.bottom),
    header: numericField(item.header),
    footer: numericField(item.footer),
  };
  return Object.values(margins).some((margin) => margin !== undefined)
    ? margins
    : undefined;
}

function normalizeXlsxPageSetup(value: unknown): XlsxPageSetup | undefined {
  const item = isRecord(value) ? value : {};
  const setup: XlsxPageSetup = {
    orientation:
      item.orientation === "portrait" || item.orientation === "landscape"
        ? item.orientation
        : undefined,
    paperSize: numericField(item.paperSize),
    scale: numericField(item.scale),
    fitToWidth: numericField(item.fitToWidth),
    fitToHeight: numericField(item.fitToHeight),
  };
  return Object.values(setup).some((field) => field !== undefined)
    ? setup
    : undefined;
}
