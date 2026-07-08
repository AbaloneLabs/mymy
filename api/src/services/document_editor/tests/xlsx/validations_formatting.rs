use super::super::super::*;

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
