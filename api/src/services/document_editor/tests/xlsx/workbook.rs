use super::super::super::*;

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
