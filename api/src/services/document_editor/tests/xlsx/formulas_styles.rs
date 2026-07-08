use super::super::super::*;
use super::super::common::*;

#[test]
fn xlsx_update_marks_workbook_for_recalculation_when_formulas_exist() {
    let original = test_ooxml_package(&[
        ("[Content_Types].xml", "<Types></Types>"),
        (
            "xl/workbook.xml",
            r#"<workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
        ),
        (
            "xl/_rels/workbook.xml.rels",
            r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
        ),
        (
            "xl/worksheets/sheet1.xml",
            r#"<worksheet><sheetData/></worksheet>"#,
        ),
    ]);
    let model = json!({
        "sheets": [{
            "id": "xl/worksheets/sheet1.xml",
            "name": "Sheet1",
            "rows": [{
                "index": "1",
                "cells": [{
                    "ref": "A1",
                    "value": "",
                    "formula": "B1+C1"
                }]
            }]
        }]
    });

    let updated = update_xlsx(&original, &model).unwrap();
    let workbook = read_zip_text(&updated, "xl/workbook.xml").unwrap();

    assert!(workbook.contains(r#"calcMode="auto""#));
    assert!(workbook.contains(r#"fullCalcOnLoad="1""#));
    assert!(workbook.contains(r#"forceFullCalc="1""#));
}

#[test]
fn xlsx_parser_exposes_formula_cells() {
    let xml = r#"<worksheet><sheetData><row r="1"><c r="C1"><f>A1+B1</f><v>3</v></c></row></sheetData></worksheet>"#;

    let rows = parse_sheet_rows(xml, &[], None);

    assert_eq!(rows[0]["cells"][0]["formula"], "A1+B1");
    assert_eq!(rows[0]["cells"][0]["value"], "3");
}

#[test]
fn xlsx_parser_exposes_formula_metadata() {
    let xml = r#"<worksheet><sheetData><row r="1"><c r="A1"><f t="array" ref="A1:B2" si="0">TRANSPOSE(C1:D2)</f><v>1</v></c></row></sheetData></worksheet>"#;

    let rows = parse_sheet_rows(xml, &[], None);

    assert_eq!(rows[0]["cells"][0]["formula"], "TRANSPOSE(C1:D2)");
    assert_eq!(rows[0]["cells"][0]["formulaType"], "array");
    assert_eq!(rows[0]["cells"][0]["formulaRef"], "A1:B2");
    assert_eq!(rows[0]["cells"][0]["formulaSharedIndex"], "0");
}

#[test]
fn xlsx_parser_exposes_basic_cell_styles() {
    let styles = xlsx_styles_from_xml(
        r##"<styleSheet>
            <numFmts count="1"><numFmt numFmtId="164" formatCode="$#,##0.00"/></numFmts>
            <fonts count="2">
              <font><sz val="11"/><name val="Calibri"/></font>
              <font><b/><i/><u/><strike/><sz val="14"/><color rgb="FF1F2937"/><name val="Noto Sans"/></font>
            </fonts>
            <fills count="3">
              <fill><patternFill patternType="none"/></fill>
              <fill><patternFill patternType="gray125"/></fill>
              <fill><patternFill patternType="solid"><fgColor rgb="FFFDE68A"/></patternFill></fill>
            </fills>
            <cellXfs count="2">
              <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
              <xf numFmtId="164" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
            </cellXfs>
          </styleSheet>"##,
    );
    let xml = r#"<worksheet><sheetData><row r="1"><c r="A1" s="1" t="inlineStr"><is><t>Total</t></is></c></row></sheetData></worksheet>"#;

    let rows = parse_sheet_rows(xml, &[], Some(&styles));
    let cell = &rows[0]["cells"][0];

    assert_eq!(cell["fontFamily"], "Noto Sans");
    assert_eq!(cell["fontSize"], "14");
    assert_eq!(cell["numberFormat"], "$#,##0.00");
    assert_eq!(cell["color"], "#1F2937");
    assert_eq!(cell["fillColor"], "#FDE68A");
    assert_eq!(cell["align"], "center");
    assert_eq!(cell["verticalAlign"], "middle");
    assert_eq!(cell["bold"], true);
    assert_eq!(cell["italic"], true);
    assert_eq!(cell["underline"], true);
    assert_eq!(cell["strikethrough"], true);
    assert_eq!(cell["wrapText"], true);
}

#[test]
fn xlsx_style_writer_assigns_cell_style_indexes() {
    let mut writer = XlsxStyleWriter::new(None);
    let mut update = SheetUpdate {
        cells: BTreeMap::from([(
            "A1".to_string(),
            SheetCellWrite {
                value: "Total".to_string(),
                style: Some(XlsxCellStyle {
                    number_format: Some("$#,##0.00".to_string()),
                    font_family: Some("Noto Sans".to_string()),
                    font_size: Some("14".to_string()),
                    bold: true,
                    color: Some("1F2937".to_string()),
                    fill_color: Some("FDE68A".to_string()),
                    align: Some("right".to_string()),
                    wrap_text: true,
                    ..XlsxCellStyle::default()
                }),
                ..SheetCellWrite::default()
            },
        )]),
        ..SheetUpdate::default()
    };

    writer.assign_sheet_styles(&mut update);
    let updated = build_xlsx_worksheet(&update);

    assert!(writer.changed);
    assert!(writer.xml.contains(r#"<b/>"#));
    assert!(writer.xml.contains(r#"<name val="Noto Sans"/>"#));
    assert!(writer.xml.contains(r#"<fgColor rgb="FFFDE68A"/>"#));
    assert!(writer.xml.contains(r#"formatCode="$#,##0.00""#));
    assert!(updated.contains(r#"<c r="A1" s="1" t="inlineStr"><is><t>Total</t></is></c>"#));
}
