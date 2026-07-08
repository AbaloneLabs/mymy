use super::super::*;
use super::common::*;

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

#[test]
fn xlsx_parser_exposes_data_validations() {
    let xml = r#"<worksheet><sheetData/><dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="A1:A3" errorTitle="Invalid" error="Choose from list"><formula1>"A,B,C"</formula1></dataValidation></dataValidations></worksheet>"#;

    let validations = parse_sheet_data_validations(xml);

    assert_eq!(validations[0]["sqref"], "A1:A3");
    assert_eq!(validations[0]["type"], "list");
    assert_eq!(validations[0]["formula1"], "\"A,B,C\"");
    assert_eq!(validations[0]["allowBlank"], true);
    assert_eq!(validations[0]["showErrorMessage"], true);
    assert_eq!(validations[0]["errorTitle"], "Invalid");
    assert_eq!(validations[0]["error"], "Choose from list");
}

#[test]
fn xlsx_sheet_update_writes_data_validations() {
    let xml =
        r#"<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>"#;
    let update = SheetUpdate {
        cells: BTreeMap::from([(
            "A1".to_string(),
            SheetCellWrite {
                value: "1".to_string(),
                ..SheetCellWrite::default()
            },
        )]),
        data_validations: vec![SheetDataValidation {
            sqref: "A1:A2".to_string(),
            validation_type: Some("whole".to_string()),
            operator: Some("between".to_string()),
            formula1: Some("1".to_string()),
            formula2: Some("10".to_string()),
            allow_blank: true,
            show_error_message: true,
            error_title: Some("Invalid".to_string()),
            error: Some("Enter 1 through 10".to_string()),
            ..SheetDataValidation::default()
        }],
        ..SheetUpdate::default()
    };

    let updated = update_xlsx_worksheet(xml, &update);

    assert!(updated.contains(r#"<dataValidations count="1">"#));
    assert!(updated.contains(r#"<dataValidation sqref="A1:A2" type="whole" operator="between" allowBlank="1" showErrorMessage="1" errorTitle="Invalid" error="Enter 1 through 10">"#));
    assert!(updated.contains("<formula1>1</formula1>"));
    assert!(updated.contains("<formula2>10</formula2>"));
}

#[test]
fn xlsx_parser_reads_and_writes_auto_filter() {
    let xml = r#"<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><autoFilter ref="A1:B3"/></worksheet>"#;

    assert_eq!(parse_sheet_auto_filter(xml), Some("A1:B3".to_string()));

    let update = SheetUpdate {
        cells: BTreeMap::from([(
            "A1".to_string(),
            SheetCellWrite {
                value: "1".to_string(),
                ..SheetCellWrite::default()
            },
        )]),
        auto_filter: Some("A1:C10".to_string()),
        ..SheetUpdate::default()
    };
    let updated = update_xlsx_worksheet(xml, &update);

    assert!(updated.contains(r#"<autoFilter ref="A1:C10"/>"#));
    assert!(!updated.contains(r#"<autoFilter ref="A1:B3"/>"#));
}

#[test]
fn xlsx_parser_exposes_conditional_formatting_fill() {
    let styles = xlsx_styles_from_xml(
        r#"<styleSheet><dxfs count="1"><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFFF3BF"/></patternFill></fill></dxf></dxfs></styleSheet>"#,
    );
    let xml = r#"<worksheet><sheetData/><conditionalFormatting sqref="A1:A3"><cfRule type="cellIs" operator="greaterThan" dxfId="0" priority="1"><formula>10</formula></cfRule></conditionalFormatting></worksheet>"#;

    let formattings = parse_sheet_conditional_formattings(xml, Some(&styles));

    assert_eq!(formattings[0]["sqref"], "A1:A3");
    assert_eq!(formattings[0]["rules"][0]["type"], "cellIs");
    assert_eq!(formattings[0]["rules"][0]["operator"], "greaterThan");
    assert_eq!(formattings[0]["rules"][0]["fillColor"], "#FFF3BF");
    assert_eq!(formattings[0]["rules"][0]["formulas"][0], "10");
}

#[test]
fn xlsx_sheet_update_writes_conditional_formatting() {
    let xml = r#"<worksheet><sheetData><row r="1"><c r="A1"><v>11</v></c></row></sheetData><conditionalFormatting sqref="B1:B2"><cfRule type="duplicateValues" priority="1"/></conditionalFormatting></worksheet>"#;
    let update = SheetUpdate {
        cells: BTreeMap::from([(
            "A1".to_string(),
            SheetCellWrite {
                value: "11".to_string(),
                ..SheetCellWrite::default()
            },
        )]),
        conditional_formattings: vec![SheetConditionalFormatting {
            sqref: "A1:A2".to_string(),
            rules: vec![SheetConditionalRule {
                rule_type: Some("cellIs".to_string()),
                operator: Some("greaterThan".to_string()),
                priority: Some(3),
                dxf_id: Some(2),
                formulas: vec!["10".to_string()],
                ..SheetConditionalRule::default()
            }],
        }],
        ..SheetUpdate::default()
    };

    let updated = update_xlsx_worksheet(xml, &update);

    assert!(updated.contains(r#"<conditionalFormatting sqref="A1:A2">"#));
    assert!(updated.contains(
        r#"<cfRule type="cellIs" priority="3" operator="greaterThan" dxfId="2"><formula>10</formula></cfRule>"#
    ));
    assert!(!updated.contains("B1:B2"));
}

#[test]
fn xlsx_style_writer_adds_conditional_formatting_dxf() {
    let mut update = SheetUpdate {
        conditional_formattings: vec![SheetConditionalFormatting {
            sqref: "A1:A1".to_string(),
            rules: vec![SheetConditionalRule {
                rule_type: Some("cellIs".to_string()),
                operator: Some("equal".to_string()),
                fill_color: Some("E7F5D8".to_string()),
                formulas: vec!["1".to_string()],
                ..SheetConditionalRule::default()
            }],
        }],
        ..SheetUpdate::default()
    };
    let mut writer = XlsxStyleWriter::new(None);

    writer.assign_sheet_styles(&mut update);

    assert_eq!(update.conditional_formattings[0].rules[0].dxf_id, Some(0));
    assert!(writer.xml.contains(r#"<dxfs count="1">"#));
    assert!(writer.xml.contains(r#"<fgColor rgb="FFE7F5D8"/>"#));
}

#[test]
fn xlsx_parser_reads_sheet_protection_and_page_setup() {
    let xml = r#"<worksheet><sheetData/><sheetProtection sheet="1" password="ABCD" objects="1" autoFilter="1"/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup orientation="landscape" paperSize="9" scale="90"/></worksheet>"#;

    let protection = parse_sheet_protection(xml).expect("protection should parse");
    let margins = parse_sheet_page_margins(xml).expect("margins should parse");
    let setup = parse_sheet_page_setup(xml).expect("setup should parse");

    assert_eq!(protection["enabled"], true);
    assert_eq!(protection["password"], "ABCD");
    assert_eq!(protection["objects"], true);
    assert_eq!(protection["autoFilter"], true);
    assert_eq!(margins["left"], 0.7);
    assert_eq!(margins["footer"], 0.3);
    assert_eq!(setup["orientation"], "landscape");
    assert_eq!(setup["paperSize"], 9);
    assert_eq!(setup["scale"], 90);
}

#[test]
fn xlsx_sheet_update_writes_sheet_protection_and_page_setup() {
    let xml = r#"<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><sheetProtection sheet="1" password="OLD"/><pageMargins left="1"/><pageSetup orientation="portrait"/></worksheet>"#;
    let update = SheetUpdate {
        cells: BTreeMap::from([(
            "A1".to_string(),
            SheetCellWrite {
                value: "1".to_string(),
                ..SheetCellWrite::default()
            },
        )]),
        protection: Some(SheetProtection {
            enabled: true,
            password: Some("ABCD".to_string()),
            objects: true,
            auto_filter: true,
            ..SheetProtection::default()
        }),
        page_margins: Some(SheetPageMargins {
            left: Some(0.7),
            right: Some(0.7),
            top: Some(0.75),
            bottom: Some(0.75),
            header: Some(0.3),
            footer: Some(0.3),
        }),
        page_setup: Some(SheetPageSetup {
            orientation: Some("landscape".to_string()),
            paper_size: Some(9),
            scale: Some(90),
            ..SheetPageSetup::default()
        }),
        ..SheetUpdate::default()
    };

    let updated = update_xlsx_worksheet(xml, &update);

    assert!(updated
        .contains(r#"<sheetProtection sheet="1" password="ABCD" objects="1" autoFilter="1"/>"#));
    assert!(updated.contains(
        r#"<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>"#
    ));
    assert!(updated.contains(r#"<pageSetup orientation="landscape" paperSize="9" scale="90"/>"#));
    assert!(!updated.contains("OLD"));
}

#[test]
fn xlsx_parser_exposes_hyperlink_targets() {
    let xml = r#"<worksheet><sheetData/><hyperlinks><hyperlink ref="A1" r:id="rId2" display="Open" tooltip="Docs"/><hyperlink ref="B2" location="Sheet2!A1" display="Jump"/></hyperlinks></worksheet>"#;
    let targets = BTreeMap::from([("rId2".to_string(), "https://example.com/docs".to_string())]);

    let hyperlinks = parse_sheet_hyperlinks(xml, &targets);

    assert_eq!(hyperlinks[0]["ref"], "A1");
    assert_eq!(hyperlinks[0]["relationshipId"], "rId2");
    assert_eq!(hyperlinks[0]["target"], "https://example.com/docs");
    assert_eq!(hyperlinks[0]["display"], "Open");
    assert_eq!(hyperlinks[0]["tooltip"], "Docs");
    assert_eq!(hyperlinks[1]["ref"], "B2");
    assert_eq!(hyperlinks[1]["location"], "Sheet2!A1");
}

#[test]
fn xlsx_sheet_update_writes_hyperlinks_and_namespace() {
    let xml = r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><hyperlinks><hyperlink ref="B1" location="Old!A1"/></hyperlinks></worksheet>"#;
    let update = SheetUpdate {
        cells: BTreeMap::from([(
            "A1".to_string(),
            SheetCellWrite {
                value: "1".to_string(),
                ..SheetCellWrite::default()
            },
        )]),
        hyperlinks: vec![
            SheetHyperlink {
                reference: "A1".to_string(),
                relationship_id: Some("rId3".to_string()),
                target: Some("https://example.com".to_string()),
                display: Some("Example".to_string()),
                tooltip: Some("Open example".to_string()),
                ..SheetHyperlink::default()
            },
            SheetHyperlink {
                reference: "C1".to_string(),
                location: Some("Sheet2!A1".to_string()),
                display: Some("Jump".to_string()),
                ..SheetHyperlink::default()
            },
        ],
        ..SheetUpdate::default()
    };

    let updated = update_xlsx_worksheet(xml, &update);

    assert!(updated.contains(
        r#"xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#
    ));
    assert!(updated
        .contains(r#"<hyperlink ref="A1" r:id="rId3" display="Example" tooltip="Open example"/>"#));
    assert!(updated.contains(r#"<hyperlink ref="C1" location="Sheet2!A1" display="Jump"/>"#));
    assert!(!updated.contains("Old!A1"));
}

#[test]
fn xlsx_hyperlink_relationships_replace_only_hyperlink_rels() {
    let rels = r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://old.example" TargetMode="External"/></Relationships>"#;
    let mut update = SheetUpdate {
        hyperlinks: vec![SheetHyperlink {
            reference: "A1".to_string(),
            target: Some("https://new.example".to_string()),
            ..SheetHyperlink::default()
        }],
        ..SheetUpdate::default()
    };

    let updated =
        update_sheet_hyperlink_relationships(Some(rels), &mut update).expect("rels update");

    assert!(updated.contains("relationships/drawing"));
    assert!(updated.contains(r#"Target="../drawings/drawing1.xml""#));
    assert!(updated.contains("https://new.example"));
    assert!(!updated.contains("https://old.example"));
    assert_eq!(
        update.hyperlinks[0].relationship_id,
        Some("rId2".to_string())
    );
}

#[test]
fn xlsx_parser_exposes_comments_with_authors() {
    let xml = r#"<comments><authors><author>Elena</author></authors><commentList><comment ref="B2" authorId="0"><text><t>First</t><t>Second</t></text></comment></commentList></comments>"#;

    let comments = parse_sheet_comments(xml);

    assert_eq!(comments[0]["ref"], "B2");
    assert_eq!(comments[0]["author"], "Elena");
    assert_eq!(comments[0]["authorId"], 0);
    assert_eq!(comments[0]["text"], "First\nSecond");
}

#[test]
fn xlsx_comment_package_adds_relationships_parts_and_content_types() {
    let mut rels = None;
    let mut replacements = Vec::new();
    let mut comments_content_types = Vec::new();
    let mut needs_vml_content_type = false;
    let comments = vec![SheetComment {
        reference: "C3".to_string(),
        author: Some("Elena".to_string()),
        text: "Check this".to_string(),
    }];

    let legacy_drawing_id = update_sheet_comments_package(
        "xl/worksheets/sheet1.xml",
        &mut rels,
        &comments,
        &[],
        &mut replacements,
        &mut comments_content_types,
        &mut needs_vml_content_type,
    )
    .expect("legacy drawing relationship");
    let worksheet = update_sheet_legacy_drawing(
        "<worksheet><sheetData/></worksheet>",
        Some(&legacy_drawing_id),
    );
    let content_types = ensure_xlsx_comments_content_types(
        "<Types></Types>",
        &comments_content_types,
        needs_vml_content_type,
    );

    let rels = rels.expect("sheet rels");
    assert!(rels.contains("relationships/comments"));
    assert!(rels.contains(r#"Target="../comments1.xml""#));
    assert!(rels.contains("relationships/vmlDrawing"));
    assert!(rels.contains(r#"Target="../drawings/vmlDrawing1.vml""#));
    assert!(worksheet.contains(r#"<legacyDrawing r:id=""#));
    assert!(worksheet.contains("xmlns:r="));
    assert_eq!(replacements[0].0, "xl/comments1.xml");
    assert!(String::from_utf8_lossy(&replacements[0].1).contains("Check this"));
    assert_eq!(replacements[1].0, "xl/drawings/vmlDrawing1.vml");
    assert!(String::from_utf8_lossy(&replacements[1].1).contains("<x:Row>2</x:Row>"));
    assert!(String::from_utf8_lossy(&replacements[1].1).contains("<x:Column>2</x:Column>"));
    assert!(content_types.contains("spreadsheetml.comments+xml"));
    assert!(content_types.contains("vmlDrawing"));
}

#[test]
fn xlsx_sheet_objects_parse_charts_images_and_pivots() {
    let sheet_xml = r#"<worksheet><drawing r:id="rIdDrawing"/><tableParts count="1"><tablePart r:id="rIdTable"/></tableParts><pivotTableDefinitions><pivotTableDefinition r:id="rIdPivot"/></pivotTableDefinitions></worksheet>"#;
    let sheet_rels = r#"<Relationships><Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/><Relationship Id="rIdTable" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/><Relationship Id="rIdPivot" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable" Target="../pivotTables/pivotTable1.xml"/></Relationships>"#;
    let drawing_xml = r#"<xdr:wsDr><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>2</xdr:row></xdr:from><xdr:to><xdr:col>4</xdr:col><xdr:row>9</xdr:row></xdr:to><xdr:graphicFrame><a:graphic><a:graphicData><c:chart r:id="rIdChart"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:twoCellAnchor><xdr:oneCellAnchor><xdr:from><xdr:col>5</xdr:col><xdr:row>6</xdr:row></xdr:from><xdr:pic><xdr:blipFill><a:blip r:embed="rIdImage"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor></xdr:wsDr>"#;
    let drawing_rels = r#"<Relationships><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>"#;
    let chart_xml = r#"<c:chartSpace><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Revenue</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:ser><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>Series A</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>Q1</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>120</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:axPos val="b"/><c:title><c:tx><c:rich><a:p><a:r><a:t>Quarter</a:t></a:r></a:p></c:rich></c:tx></c:title><c:tickLblPos val="nextTo"/></c:catAx><c:valAx><c:axId val="2"/><c:axPos val="l"/><c:majorGridlines/><c:title><c:tx><c:rich><a:p><a:r><a:t>Amount</a:t></a:r></a:p></c:rich></c:tx></c:title></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/></c:legend></c:chart></c:chartSpace>"#;
    let table_xml = r#"<table name="Table1" displayName="Sales" ref="A1:B3" totalsRowShown="1"><autoFilter ref="A1:B3"/><tableColumns count="2"><tableColumn id="1" name="Region"/><tableColumn id="2" name="Revenue" totalsRowFunction="sum"/></tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="1" showRowStripes="1" showColumnStripes="0"/></table>"#;
    let pivot_xml = r#"<pivotTableDefinition name="Pivot A" cacheId="3"><pivotFields count="3"><pivotField name="Region" axis="axisRow" showAll="0" defaultSubtotal="1"/><pivotField name="Quarter" axis="axisCol" showAll="1"/><pivotField name="Revenue" dataField="1" sumSubtotal="1"/></pivotFields><rowFields count="1"><field x="0"/></rowFields><colFields count="1"><field x="1"/></colFields><dataFields count="1"><dataField fld="2" name="Sum of Revenue" subtotal="sum"/></dataFields></pivotTableDefinition>"#;
    let bytes = test_ooxml_package(&[
        ("xl/drawings/drawing1.xml", drawing_xml),
        ("xl/drawings/_rels/drawing1.xml.rels", drawing_rels),
        ("xl/charts/chart1.xml", chart_xml),
        ("xl/media/image1.png", "png-bytes"),
        ("xl/tables/table1.xml", table_xml),
        ("xl/pivotTables/pivotTable1.xml", pivot_xml),
    ]);

    let objects = parse_xlsx_sheet_objects(
        &bytes,
        "xl/worksheets/sheet1.xml",
        sheet_xml,
        Some(sheet_rels),
    );

    assert_eq!(objects.charts[0]["path"], "xl/charts/chart1.xml");
    assert_eq!(objects.charts[0]["type"], "bar");
    assert_eq!(objects.charts[0]["title"], "Revenue");
    assert_eq!(objects.charts[0]["legendVisible"], true);
    assert_eq!(objects.charts[0]["legendPosition"], "b");
    assert_eq!(objects.charts[0]["categoryAxisTitle"], "Quarter");
    assert_eq!(objects.charts[0]["categoryAxisPosition"], "b");
    assert_eq!(objects.charts[0]["categoryAxisTickLabelPosition"], "nextTo");
    assert_eq!(objects.charts[0]["valueAxisTitle"], "Amount");
    assert_eq!(objects.charts[0]["valueAxisPosition"], "l");
    assert_eq!(objects.charts[0]["valueMajorGridlines"], true);
    assert_eq!(objects.charts[0]["categories"][0], "Q1");
    assert_eq!(objects.charts[0]["series"][0]["values"][0], "120");
    assert_eq!(objects.charts[0]["anchor"]["from"]["column"], 1);
    assert_eq!(objects.images[0]["mediaPath"], "xl/media/image1.png");
    assert_eq!(objects.images[0]["mimeType"], "image/png");
    assert!(objects.images[0]["dataUrl"]
        .as_str()
        .unwrap()
        .starts_with("data:image/png;base64,"));
    assert_eq!(objects.tables[0]["path"], "xl/tables/table1.xml");
    assert_eq!(objects.tables[0]["displayName"], "Sales");
    assert_eq!(objects.tables[0]["ref"], "A1:B3");
    assert_eq!(objects.tables[0]["autoFilterRef"], "A1:B3");
    assert_eq!(objects.tables[0]["totalsRowShown"], true);
    assert_eq!(objects.tables[0]["tableStyleName"], "TableStyleMedium2");
    assert_eq!(objects.tables[0]["showLastColumn"], true);
    assert_eq!(objects.tables[0]["showRowStripes"], true);
    assert_eq!(objects.tables[0]["columns"][1]["name"], "Revenue");
    assert_eq!(objects.tables[0]["columns"][1]["totalsRowFunction"], "sum");
    assert_eq!(objects.pivots[0]["path"], "xl/pivotTables/pivotTable1.xml");
    assert_eq!(objects.pivots[0]["name"], "Pivot A");
    assert_eq!(objects.pivots[0]["cacheId"], "3");
    assert_eq!(objects.pivots[0]["fields"][0]["name"], "Region");
    assert_eq!(objects.pivots[0]["fields"][0]["axis"], "axisRow");
    assert_eq!(objects.pivots[0]["fields"][0]["showAll"], false);
    assert_eq!(objects.pivots[0]["fields"][0]["defaultSubtotal"], true);
    assert_eq!(objects.pivots[0]["fields"][1]["axis"], "axisCol");
    assert_eq!(objects.pivots[0]["fields"][2]["dataField"], true);
    assert_eq!(objects.pivots[0]["fields"][2]["subtotal"], "sum");
    assert_eq!(objects.pivots[0]["dataFields"][0]["fieldIndex"], 2);
    assert_eq!(objects.pivots[0]["dataFields"][0]["name"], "Sum of Revenue");
    assert_eq!(objects.pivots[0]["dataFields"][0]["subtotal"], "sum");
}

#[test]
fn xlsx_table_update_writes_table_metadata() {
    let xml = r#"<table name="OldTable" displayName="Old" ref="A1:B3" totalsRowShown="0"><autoFilter ref="A1:B3"/><tableColumns count="2"><tableColumn id="1" name="Old A"/><tableColumn id="2" name="Old B"/></tableColumns><tableStyleInfo name="TableStyleLight1" showRowStripes="1"/></table>"#;
    let table = json!({
        "name": "Table1",
        "displayName": "Sales",
        "ref": "A1:C5",
        "autoFilterRef": "A1:C5",
        "totalsRowShown": true,
        "tableStyleName": "TableStyleMedium9",
        "showFirstColumn": true,
        "showLastColumn": false,
        "showRowStripes": true,
        "showColumnStripes": true,
        "columns": [
            { "id": "1", "name": "Region" },
            { "id": "2", "name": "Revenue", "totalsRowFunction": "sum" },
            { "id": "3", "name": "Margin", "totalsRowFunction": "average" }
        ]
    });

    let updated = update_xlsx_table_xml(xml, &table);

    assert!(updated
        .contains(r#"<table name="Table1" displayName="Sales" ref="A1:C5" totalsRowShown="1">"#));
    assert!(updated.contains(r#"<autoFilter ref="A1:C5"/>"#));
    assert!(updated.contains(r#"<tableColumns count="3">"#));
    assert!(updated.contains(r#"<tableColumn id="2" name="Revenue" totalsRowFunction="sum"/>"#));
    assert!(updated.contains(
        r#"<tableStyleInfo name="TableStyleMedium9" showFirstColumn="1" showLastColumn="0" showRowStripes="1" showColumnStripes="1"/>"#
    ));
    assert!(!updated.contains("OldTable"));
}

#[test]
fn xlsx_update_creates_new_table_part() {
    let original = test_ooxml_package(&[
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>"#,
        ),
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
            "rows": [],
            "tables": [{
                "id": "table-local-1",
                "name": "Table1",
                "displayName": "Table1",
                "ref": "A1:B3",
                "autoFilterRef": "A1:B3",
                "totalsRowShown": true,
                "tableStyleName": "TableStyleMedium2",
                "showRowStripes": true,
                "columns": [
                    { "id": "1", "name": "Region" },
                    { "id": "2", "name": "Revenue", "totalsRowFunction": "sum" }
                ]
            }]
        }]
    });

    let updated = update_xlsx(&original, &model).unwrap();
    let worksheet = read_zip_text(&updated, "xl/worksheets/sheet1.xml").unwrap();
    let rels = read_zip_text(&updated, "xl/worksheets/_rels/sheet1.xml.rels").unwrap();
    let table = read_zip_text(&updated, "xl/tables/table1.xml").unwrap();
    let content_types = read_zip_text(&updated, "[Content_Types].xml").unwrap();

    assert!(worksheet.contains(
        r#"xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#
    ));
    assert!(worksheet.contains(r#"<tableParts count="1"><tablePart r:id="rId1"/></tableParts>"#));
    assert!(rels.contains(
        r#"Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table""#
    ));
    assert!(rels.contains(r#"Target="../tables/table1.xml""#));
    assert!(table.contains(r#"<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Table1" displayName="Table1" ref="A1:B3" totalsRowShown="1">"#));
    assert!(table.contains(r#"<autoFilter ref="A1:B3"/>"#));
    assert!(table.contains(r#"<tableColumn id="2" name="Revenue" totalsRowFunction="sum"/>"#));
    assert!(content_types.contains(r#"PartName="/xl/tables/table1.xml""#));
}

#[test]
fn xlsx_update_rewrites_chart_title_metadata_and_cached_series_values() {
    let chart_xml = r#"<c:chartSpace><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Revenue</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:ser><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>Series A</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>Q1</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>120</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/></c:catAx><c:valAx><c:axId val="2"/><c:axPos val="l"/></c:valAx></c:plotArea><c:legend><c:legendPos val="r"/></c:legend></c:chart></c:chartSpace>"#;
    let original = test_ooxml_package(&[
        (
            "xl/worksheets/sheet1.xml",
            r#"<worksheet><sheetData/></worksheet>"#,
        ),
        ("xl/charts/chart1.xml", chart_xml),
    ]);
    let model = json!({
        "sheets": [{
            "id": "xl/worksheets/sheet1.xml",
            "name": "Sheet1",
            "rows": [],
            "charts": [{
                "id": "rIdChart",
                "path": "xl/charts/chart1.xml",
                "type": "line",
                "title": "Updated revenue",
                "legendVisible": true,
                "legendPosition": "b",
                "categoryAxisTitle": "Quarter",
                "categoryAxisPosition": "t",
                "categoryAxisTickLabelPosition": "low",
                "valueAxisTitle": "Amount",
                "valueAxisPosition": "r",
                "valueMajorGridlines": true,
                "valueAxisNumberFormat": "$#,##0",
                "series": [{
                    "name": "Updated series",
                    "categories": ["Q2"],
                    "values": ["240"]
                }]
            }]
        }]
    });

    let updated = update_xlsx(&original, &model).unwrap();
    let chart = read_zip_text(&updated, "xl/charts/chart1.xml").unwrap();

    assert!(chart.contains(">Updated revenue<"));
    assert!(chart.contains("<c:lineChart>"));
    assert!(chart.contains(r#"<c:legendPos val="b"/>"#));
    assert!(chart.contains(">Quarter<"));
    assert!(chart.contains(r#"<c:axPos val="t"/>"#));
    assert!(chart.contains(r#"<c:tickLblPos val="low"/>"#));
    assert!(chart.contains(">Amount<"));
    assert!(chart.contains(r#"<c:axPos val="r"/>"#));
    assert!(chart.contains(r#"<c:majorGridlines/>"#));
    assert!(chart.contains(r#"formatCode="$#,##0""#));
    assert!(chart.contains(">Updated series<"));
    assert!(chart.contains(">Q2<"));
    assert!(chart.contains(">240<"));
    assert!(!chart.contains(">120<"));
}

#[test]
fn ooxml_chart_series_reads_range_formulas() {
    let chart_xml = r#"<c:chartSpace><c:chart><c:plotArea><c:barChart><c:ser><c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:pt idx="0"><c:v>Actual</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:f>Sheet1!$A$2:$A$3</c:f><c:strCache><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>"#;
    let series = ooxml_chart_series(chart_xml);

    assert_eq!(series[0]["name"], "Actual");
    assert_eq!(series[0]["nameFormula"], "Sheet1!$B$1");
    assert_eq!(series[0]["categoriesFormula"], "Sheet1!$A$2:$A$3");
    assert_eq!(series[0]["valuesFormula"], "Sheet1!$B$2:$B$3");
}

#[test]
fn xlsx_update_rewrites_chart_range_formulas_and_inserts_series() {
    let chart_xml = r#"<c:chartSpace><c:chart><c:plotArea><c:barChart><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:pt idx="0"><c:v>Actual</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:f>Sheet1!$A$2:$A$3</c:f><c:strCache><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/></c:catAx><c:valAx><c:axId val="2"/></c:valAx></c:plotArea></c:chart></c:chartSpace>"#;
    let original = test_ooxml_package(&[
        (
            "xl/worksheets/sheet1.xml",
            r#"<worksheet><sheetData/></worksheet>"#,
        ),
        ("xl/charts/chart1.xml", chart_xml),
    ]);
    let model = json!({
        "sheets": [{
            "id": "xl/worksheets/sheet1.xml",
            "name": "Sheet1",
            "rows": [],
            "charts": [{
                "id": "rIdChart",
                "path": "xl/charts/chart1.xml",
                "series": [
                    {
                        "name": "Updated actual",
                        "nameFormula": "Sheet1!$C$1",
                        "categories": ["Q1", "Q2", "Q3"],
                        "categoriesFormula": "Sheet1!$A$2:$A$4",
                        "values": ["11", "22", "33"],
                        "valuesFormula": "Sheet1!$C$2:$C$4"
                    },
                    {
                        "name": "Projected",
                        "nameFormula": "Sheet1!$D$1",
                        "categoriesFormula": "Sheet1!$A$2:$A$4",
                        "valuesFormula": "Sheet1!$D$2:$D$4"
                    }
                ]
            }]
        }]
    });

    let updated = update_xlsx(&original, &model).unwrap();
    let chart = read_zip_text(&updated, "xl/charts/chart1.xml").unwrap();

    assert!(chart.contains("<c:f>Sheet1!$C$1</c:f>"));
    assert!(chart.contains("<c:f>Sheet1!$A$2:$A$4</c:f>"));
    assert!(chart.contains("<c:f>Sheet1!$C$2:$C$4</c:f>"));
    assert!(chart.contains(">33<"));
    assert!(chart.contains(r#"<c:idx val="1"/><c:order val="1"/>"#));
    assert!(chart.contains("<c:f>Sheet1!$D$1</c:f>"));
    assert!(chart.contains("<c:f>Sheet1!$D$2:$D$4</c:f>"));
    assert!(chart.find(r#"<c:idx val="1""#).unwrap() < chart.find(r#"<c:axId val="1""#).unwrap());
}

#[test]
fn xlsx_update_rewrites_pivot_table_name() {
    let original = test_ooxml_package(&[
        (
            "xl/worksheets/sheet1.xml",
            r#"<worksheet><sheetData/></worksheet>"#,
        ),
        (
            "xl/pivotTables/pivotTable1.xml",
            r#"<pivotTableDefinition name="Old Pivot" cacheId="1"></pivotTableDefinition>"#,
        ),
    ]);
    let model = json!({
        "sheets": [{
            "id": "xl/worksheets/sheet1.xml",
            "name": "Sheet1",
            "rows": [],
            "pivots": [{
                "id": "rIdPivot",
                "path": "xl/pivotTables/pivotTable1.xml",
                "name": "Updated Pivot"
            }]
        }]
    });

    let updated = update_xlsx(&original, &model).unwrap();
    let pivot = read_zip_text(&updated, "xl/pivotTables/pivotTable1.xml").unwrap();

    assert!(pivot.contains(r#"name="Updated Pivot""#));
    assert!(pivot.contains(r#"cacheId="1""#));
    assert!(!pivot.contains("Old Pivot"));
}

#[test]
fn xlsx_update_rewrites_pivot_fields_and_data_fields() {
    let original = test_ooxml_package(&[
        (
            "xl/worksheets/sheet1.xml",
            r#"<worksheet><sheetData/></worksheet>"#,
        ),
        (
            "xl/pivotTables/pivotTable1.xml",
            r#"<pivotTableDefinition name="Old Pivot" cacheId="1"><pivotFields count="3"><pivotField name="Region" axis="axisRow" showAll="0" defaultSubtotal="1"/><pivotField name="Quarter" axis="axisCol"/><pivotField name="Revenue" dataField="1" sumSubtotal="1"/></pivotFields><rowFields count="1"><field x="0"/></rowFields><colFields count="1"><field x="1"/></colFields><dataFields count="1"><dataField fld="2" name="Sum of Revenue" subtotal="sum"/></dataFields></pivotTableDefinition>"#,
        ),
    ]);
    let model = json!({
        "sheets": [{
            "id": "xl/worksheets/sheet1.xml",
            "name": "Sheet1",
            "rows": [],
            "pivots": [{
                "id": "rIdPivot",
                "path": "xl/pivotTables/pivotTable1.xml",
                "name": "Updated Pivot",
                "fields": [
                    {
                        "index": 0,
                        "name": "Region",
                        "axis": "axisCol",
                        "dataField": false,
                        "showAll": true,
                        "defaultSubtotal": false,
                        "subtotal": "countA"
                    },
                    {
                        "index": 1,
                        "name": "Quarter",
                        "axis": "axisRow",
                        "dataField": false
                    },
                    {
                        "index": 2,
                        "name": "Revenue",
                        "axis": "axisValues",
                        "dataField": true,
                        "subtotal": "sum"
                    }
                ],
                "dataFields": [{
                    "fieldIndex": 2,
                    "name": "Average Revenue",
                    "subtotal": "average"
                }]
            }]
        }]
    });

    let updated = update_xlsx(&original, &model).unwrap();
    let pivot = read_zip_text(&updated, "xl/pivotTables/pivotTable1.xml").unwrap();

    assert!(pivot.contains(r#"name="Updated Pivot""#));
    assert!(pivot.contains(r#"name="Region" axis="axisCol""#));
    assert!(pivot.contains(r#"showAll="1""#));
    assert!(pivot.contains(r#"defaultSubtotal="0""#));
    assert!(pivot.contains(r#"countASubtotal="1""#));
    assert!(pivot.contains(r#"name="Quarter" axis="axisRow""#));
    assert!(pivot.contains(r#"name="Revenue""#));
    assert!(pivot.contains(r#"axis="axisValues""#));
    assert!(pivot.contains(r#"dataField="1""#));
    assert!(pivot.contains(r#"sumSubtotal="1""#));
    assert!(pivot.contains(r#"<rowFields count="1"><field x="1"/></rowFields>"#));
    assert!(pivot.contains(r#"<colFields count="1"><field x="0"/></colFields>"#));
    assert!(pivot.contains(
        r#"<dataFields count="1"><dataField fld="2" name="Average Revenue" subtotal="average"/></dataFields>"#
    ));
}

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

#[test]
fn xlsx_workbook_parser_maps_sheet_names_to_worksheet_paths() {
    let workbook = r#"<workbook><sheets><sheet name="Budget" sheetId="1" state="hidden" r:id="rId1"/></sheets></workbook>"#;
    let rels = r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#;

    let sheets = xlsx_workbook_sheets_from_xml(workbook, rels);

    assert_eq!(sheets[0].name, "Budget");
    assert_eq!(sheets[0].path, "xl/worksheets/sheet1.xml");
    assert_eq!(sheets[0].sheet_id, 1);
    assert_eq!(sheets[0].rel_id, "rId1");
    assert_eq!(sheets[0].state, Some("hidden".to_string()));
}

#[test]
fn xlsx_workbook_manifest_updates_renames_and_registers_new_sheets() {
    let workbook = r#"<workbook><sheets><sheet name="Old" sheetId="1" state="hidden" r:id="rId1"/></sheets></workbook>"#;
    let rels = r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#;
    let sheets = vec![
        XlsxWorkbookSheetWrite {
            path: "xl/worksheets/sheet1.xml".to_string(),
            name: "Renamed".to_string(),
            state: Some("veryHidden".to_string()),
        },
        XlsxWorkbookSheetWrite {
            path: "xl/worksheets/sheet2.xml".to_string(),
            name: "Added".to_string(),
            state: None,
        },
    ];

    let (workbook, rels) = update_xlsx_workbook_manifest(workbook, rels, &sheets);
    let content_types = append_xlsx_sheet_content_types("<Types></Types>", &sheets);

    assert!(
        workbook.contains(r#"<sheet name="Renamed" sheetId="1" r:id="rId1" state="veryHidden"/>"#)
    );
    assert!(workbook.contains(r#"<sheet name="Added" sheetId="2" r:id="rId2"/>"#));
    assert!(rels.contains(r#"Target="worksheets/sheet2.xml""#));
    assert!(content_types.contains(r#"PartName="/xl/worksheets/sheet2.xml""#));
}

#[test]
fn xlsx_sheet_pr_reads_and_writes_tab_color() {
    let xml = r#"<worksheet><sheetPr codeName="Sheet1"><tabColor rgb="FFFF0000"/></sheetPr><sheetData/></worksheet>"#;

    let tab_color = parse_sheet_tab_color(xml).expect("tab color should parse");
    assert_eq!(tab_color.color, Some("FF0000".to_string()));

    let update = SheetUpdate {
        tab_color_xml: Some(r#"<tabColor rgb="FF22C55E"/>"#.to_string()),
        ..SheetUpdate::default()
    };
    let updated = update_xlsx_worksheet(xml, &update);

    assert!(updated.contains(r#"<sheetPr codeName="Sheet1"><tabColor rgb="FF22C55E"/></sheetPr>"#));
    assert!(!updated.contains("FFFF0000"));
}

#[test]
fn xlsx_defined_names_parse_and_update_workbook() {
    let workbook = r#"<workbook><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">Budget!$A$1:$D$20</definedName><definedName name="HiddenRate" hidden="1" comment="Internal">Budget!$B$2</definedName></definedNames></workbook>"#;

    let mut names = parse_xlsx_defined_names(workbook);
    assert_eq!(names[0]["name"], "_xlnm.Print_Area");
    assert_eq!(names[0]["localSheetId"], 0);
    assert_eq!(names[1]["hidden"], true);
    assert_eq!(names[1]["comment"], "Internal");

    names[0]["value"] = json!("Budget!$A$1:$E$30");
    names.push(json!({
        "name": "ForecastRange",
        "value": "Budget!$F$1:$G$10"
    }));
    let updated = update_xlsx_defined_names(workbook, Some(&names));

    assert!(updated.contains(">Budget!$A$1:$E$30<"));
    assert!(
        updated.contains(r#"<definedName name="ForecastRange">Budget!$F$1:$G$10</definedName>"#)
    );
    assert!(updated.contains(r#"comment="Internal""#));
    assert!(!updated.contains(">Budget!$A$1:$D$20<"));
}
