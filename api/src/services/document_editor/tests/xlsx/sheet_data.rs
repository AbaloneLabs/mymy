use super::super::super::*;

#[test]
fn xlsx_sheet_update_writes_new_cells_into_sheet_data() {
    let xml = r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:A1"/><sheetData><row r="1"><c r="A1"><v>old</v></c></row></sheetData></worksheet>"#;
    let update = SheetUpdate {
        cells: BTreeMap::from([
            (
                "A1".to_string(),
                SheetCellWrite {
                    value: "updated".to_string(),
                    formula: None,
                    ..SheetCellWrite::default()
                },
            ),
            (
                "B2".to_string(),
                SheetCellWrite {
                    value: "new".to_string(),
                    formula: None,
                    ..SheetCellWrite::default()
                },
            ),
        ]),
        ..SheetUpdate::default()
    };

    let updated = update_xlsx_worksheet(xml, &update);

    assert!(updated.contains(r#"<dimension ref="A1:B2"/>"#));
    assert!(updated.contains(r#"<row r="2">"#));
    assert!(updated.contains(r#"<c r="B2" t="inlineStr"><is><t>new</t></is></c>"#));
    assert!(updated.contains(r#"<c r="A1" t="inlineStr"><is><t>updated</t></is></c>"#));
}

#[test]
fn xlsx_sheet_update_preserves_formula_cells() {
    let xml = r#"<worksheet><dimension ref="A1:C1"/><sheetData><row r="1"><c r="C1"><f>A1+B1</f><v>3</v></c></row></sheetData></worksheet>"#;
    let update = SheetUpdate {
        cells: BTreeMap::from([(
            "C1".to_string(),
            SheetCellWrite {
                value: "3".to_string(),
                formula: Some("A1+B1".to_string()),
                ..SheetCellWrite::default()
            },
        )]),
        ..SheetUpdate::default()
    };

    let updated = update_xlsx_worksheet(xml, &update);

    assert!(updated.contains(r#"<c r="C1"><f>A1+B1</f><v>3</v></c>"#));
}

#[test]
fn xlsx_sheet_update_preserves_formula_metadata() {
    let xml = r#"<worksheet><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1"><f t="array" ref="A1:B2" si="0">TRANSPOSE(C1:D2)</f><v>1</v></c></row></sheetData></worksheet>"#;
    let update = SheetUpdate {
        cells: BTreeMap::from([(
            "A1".to_string(),
            SheetCellWrite {
                value: "1".to_string(),
                formula: Some("TRANSPOSE(C1:D2)".to_string()),
                formula_type: Some("array".to_string()),
                formula_ref: Some("A1:B2".to_string()),
                formula_shared_index: Some("0".to_string()),
                ..SheetCellWrite::default()
            },
        )]),
        ..SheetUpdate::default()
    };

    let updated = update_xlsx_worksheet(xml, &update);

    assert!(updated
        .contains(r#"<c r="A1"><f t="array" ref="A1:B2" si="0">TRANSPOSE(C1:D2)</f><v>1</v></c>"#));
}

#[test]
fn xlsx_sheet_update_filters_invalid_formula_metadata_from_model() {
    let rows = vec![json!({
        "index": "1",
        "cells": [{
            "ref": "A1",
            "value": "1",
            "formula": "A2",
            "formulaType": "unsafe",
            "formulaRef": "../bad",
            "formulaSharedIndex": "x1"
        }]
    })];

    let writes = sheet_cell_writes(&rows);
    let cell = writes.get("A1").expect("cell write");

    assert_eq!(cell.formula.as_deref(), Some("A2"));
    assert_eq!(cell.formula_type, None);
    assert_eq!(cell.formula_ref, None);
    assert_eq!(cell.formula_shared_index, None);
}

#[test]
fn xlsx_sheet_update_skips_generated_spill_cells() {
    let rows = vec![json!({
        "index": "1",
        "cells": [
            { "ref": "A1", "value": "a", "formula": "UNIQUE(C1:C3)" },
            { "ref": "A2", "value": "b", "generated": "spill", "spillParent": "A1" }
        ]
    })];

    let writes = sheet_cell_writes(&rows);

    assert!(writes.contains_key("A1"));
    assert!(!writes.contains_key("A2"));
}

#[test]
fn xlsx_sheet_update_writes_columns_rows_and_merge_cells() {
    let xml = r#"<worksheet><dimension ref="A1:A1"/><sheetData><row r="1"><c r="A1"><v>old</v></c></row></sheetData></worksheet>"#;
    let update = SheetUpdate {
        cells: BTreeMap::from([(
            "A1".to_string(),
            SheetCellWrite {
                value: "updated".to_string(),
                formula: None,
                ..SheetCellWrite::default()
            },
        )]),
        rows: BTreeMap::from([(
            1,
            SheetRowWrite {
                height: Some(24.0),
                hidden: true,
            },
        )]),
        columns: vec![SheetColumnWrite {
            index: 1,
            width: Some(18.0),
            hidden: true,
        }],
        merged_ranges: vec!["A1:B1".to_string()],
        ..SheetUpdate::default()
    };

    let updated = update_xlsx_worksheet(xml, &update);

    assert!(updated
        .contains(r#"<cols><col min="1" max="1" width="18" customWidth="1" hidden="1"/></cols>"#));
    assert!(updated.contains(r#"<row r="1" ht="24" customHeight="1" hidden="1">"#));
    assert!(updated.contains(r#"<mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>"#));
}

#[test]
fn xlsx_sheet_update_reads_and_writes_frozen_panes() {
    let xml = r#"<worksheet><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1"><v>old</v></c></row></sheetData></worksheet>"#;
    let update = SheetUpdate {
        cells: BTreeMap::from([(
            "A1".to_string(),
            SheetCellWrite {
                value: "updated".to_string(),
                ..SheetCellWrite::default()
            },
        )]),
        frozen_rows: 1,
        frozen_columns: 2,
        ..SheetUpdate::default()
    };

    let updated = update_xlsx_worksheet(xml, &update);

    assert!(updated.contains(
        r#"<pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/>"#
    ));
    assert_eq!(parse_sheet_frozen_pane(&updated), (1, 2));
}
