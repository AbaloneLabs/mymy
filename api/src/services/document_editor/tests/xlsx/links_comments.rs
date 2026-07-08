use super::super::super::*;

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
