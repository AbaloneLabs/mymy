use super::super::super::*;
use super::super::common::*;

#[test]
fn docx_page_settings_read_and_update_section_properties() {
    let document = r#"<w:document><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/><w:cols w:num="2" w:space="720" w:equalWidth="0"><w:col w:w="5000"/><w:col w:w="5000"/></w:cols></w:sectPr></w:body></w:document>"#;
    let page = docx_page_settings(document);

    assert_eq!(page["width"], 12240);
    assert_eq!(page["height"], 15840);
    assert_eq!(page["marginTop"], 1440);
    assert_eq!(page["columnCount"], 2);
    assert_eq!(page["columnSpacing"], 720);
    assert_eq!(page["columnEqualWidth"], false);

    let updated = update_docx_page_settings(
        document,
        Some(&json!({
            "orientation": "landscape",
            "width": 15840,
            "height": 12240,
            "marginTop": 720,
            "marginRight": 1080,
            "marginBottom": 720,
            "marginLeft": 1080,
            "columnCount": 3,
            "columnSpacing": 540
        })),
    );

    assert!(updated.contains(r#"<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>"#));
    assert!(
        updated.contains(r#"<w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080"/>"#)
    );
    assert!(updated.contains(r#"<w:cols w:num="3" w:space="540"/>"#));
}

#[test]
fn docx_document_page_update_targets_only_the_final_section() {
    let document = r#"<w:document><w:body><w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="10000" w:h="20000"/></w:sectPr></w:pPr></w:p><w:p><w:r><w:t>Final</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12000" w:h="18000"/></w:sectPr></w:body></w:document>"#;

    let page = docx_page_settings(document);
    assert_eq!(page["width"], 12000);
    assert_eq!(page["height"], 18000);

    let updated = update_docx_page_settings(
        document,
        Some(&json!({ "width": 15840, "height": 12240, "orientation": "landscape" })),
    );
    assert!(updated.contains(r#"<w:pgSz w:w="10000" w:h="20000"/>"#));
    assert_eq!(updated.matches(r#"w:w="15840""#).count(), 1);
}

#[test]
fn docx_paragraph_builder_writes_basic_lists() {
    let bullet = build_docx_paragraph(&json!({
        "type": "paragraph",
        "text": "Bullet item",
        "listKind": "bullet"
    }));
    let numbered = build_docx_paragraph(&json!({
        "type": "paragraph",
        "text": "Numbered item",
        "listKind": "number"
    }));

    assert!(bullet.contains(&format!(r#"<w:numId w:val="{DOCX_BULLET_NUM_ID}"/>"#)));
    assert!(numbered.contains(&format!(r#"<w:numId w:val="{DOCX_NUMBER_NUM_ID}"/>"#)));
}

#[test]
fn docx_paragraph_builder_writes_list_level_and_numbering_id() {
    let numbered = build_docx_paragraph(&json!({
        "type": "paragraph",
        "text": "Nested item",
        "listKind": "number",
        "listLevel": 2,
        "listNumberingId": "42"
    }));

    assert!(numbered.contains(r#"<w:ilvl w:val="2"/>"#));
    assert!(numbered.contains(r#"<w:numId w:val="42"/>"#));
}

#[test]
fn docx_list_save_adds_numbering_part_relationship_and_content_type() {
    let original = test_ooxml_package(&[
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
        ),
        (
            "word/_rels/document.xml.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#,
        ),
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>Old</w:t></w:r></w:p></w:body></w:document>"#,
        ),
    ]);
    let updated = update_docx(
        &original,
        &json!({
            "blocks": [
                { "type": "paragraph", "text": "Item", "listKind": "bullet" }
            ]
        }),
    )
    .expect("DOCX list should save");

    let document = read_zip_text(&updated, "word/document.xml").unwrap();
    let numbering = read_zip_text(&updated, "word/numbering.xml").unwrap();
    let rels = read_zip_text(&updated, "word/_rels/document.xml.rels").unwrap();
    let content_types = read_zip_text(&updated, "[Content_Types].xml").unwrap();

    assert!(document.contains(&format!(r#"<w:numId w:val="{DOCX_BULLET_NUM_ID}"/>"#)));
    assert!(numbering.contains(r#"<w:numFmt w:val="bullet"/>"#));
    assert!(rels.contains("relationships/numbering"));
    assert!(content_types.contains(r#"PartName="/word/numbering.xml""#));
}

#[test]
fn docx_model_exposes_list_numbering_metadata_and_restart_start() {
    let bytes = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="2"/><w:numId w:val="17"/></w:numPr></w:pPr><w:r><w:t>Nested</w:t></w:r></w:p></w:body></w:document>"#,
        ),
        (
            "word/numbering.xml",
            r#"<w:numbering><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="2"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="17"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="2"><w:startOverride w:val="4"/></w:lvlOverride></w:num></w:numbering>"#,
        ),
    ]);

    let model = docx_model(&bytes).expect("DOCX list metadata should parse");
    let block = &model["blocks"][0];

    assert_eq!(block["listKind"], "number");
    assert_eq!(block["listNumberingId"], "17");
    assert_eq!(block["listLevel"], 2);
    assert_eq!(block["listStart"], 4);
}

#[test]
fn docx_list_start_saves_restart_numbering_override() {
    let original = test_ooxml_package(&[
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
        ),
        (
            "word/_rels/document.xml.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#,
        ),
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>Old</w:t></w:r></w:p></w:body></w:document>"#,
        ),
    ]);
    let updated = update_docx(
        &original,
        &json!({
            "blocks": [
                {
                    "type": "paragraph",
                    "text": "Restarted",
                    "listKind": "number",
                    "listLevel": 1,
                    "listStart": 3
                }
            ]
        }),
    )
    .expect("DOCX restarted list should save");

    let document = read_zip_text(&updated, "word/document.xml").unwrap();
    let numbering = read_zip_text(&updated, "word/numbering.xml").unwrap();

    assert!(document.contains(r#"<w:ilvl w:val="1"/>"#));
    assert!(document.contains(r#"<w:numId w:val="9100"/>"#));
    assert!(numbering.contains(r#"<w:num w:numId="9100">"#));
    assert!(numbering.contains(r#"<w:lvlOverride w:ilvl="1">"#));
    assert!(numbering.contains(r#"<w:startOverride w:val="3"/>"#));
}

#[test]
fn docx_numbering_formats_map_num_ids_to_list_kinds() {
    let numbering = ensure_docx_basic_numbering_xml("");
    let formats = docx_numbering_formats(&numbering);

    assert_eq!(formats.get(DOCX_BULLET_NUM_ID), Some(&"bullet".to_string()));
    assert_eq!(formats.get(DOCX_NUMBER_NUM_ID), Some(&"number".to_string()));
}
