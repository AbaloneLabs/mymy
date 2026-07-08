use super::super::super::*;
use super::super::common::*;

#[test]
fn docx_format_helpers_read_common_run_and_paragraph_properties() {
    let paragraph = r##"<w:p><w:pPr><w:pStyle w:val="Heading4"/><w:jc w:val="right"/><w:ind w:left="720"/><w:spacing w:before="120" w:after="240" w:line="360" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Noto Sans"/><w:sz w:val="28"/><w:color w:val="1F2937"/><w:highlight w:val="yellow"/><w:u w:val="single"/></w:rPr><w:t>Text</w:t></w:r></w:p>"##;

    assert_eq!(
        docx_tag_attr(paragraph, "<w:rFonts", "w:ascii"),
        Some("Noto Sans".to_string())
    );
    assert_eq!(docx_heading_level(paragraph), Some(4));
    assert_eq!(docx_font_size(paragraph), Some("14".to_string()));
    assert_eq!(docx_alignment(paragraph), Some("right".to_string()));
    assert_eq!(docx_u32_attr(paragraph, "<w:ind", "w:left"), Some(720));
    assert_eq!(
        docx_u32_attr(paragraph, "<w:spacing", "w:before"),
        Some(120)
    );
    assert_eq!(docx_u32_attr(paragraph, "<w:spacing", "w:after"), Some(240));
    assert_eq!(docx_u32_attr(paragraph, "<w:spacing", "w:line"), Some(360));
    assert_eq!(
        docx_tag_attr(paragraph, "<w:color", "w:val").and_then(|color| docx_hex_color(&color)),
        Some("1F2937".to_string())
    );
}

#[test]
fn docx_complex_paragraph_preserves_non_text_markup_when_replacing_text() {
    let document = r#"<w:document><w:body><w:p><w:hyperlink r:id="rId1"><w:r><w:t>Old</w:t></w:r></w:hyperlink></w:p></w:body></w:document>"#;
    let blocks = vec![json!({ "text": "New", "bold": true })];

    let updated = replace_docx_blocks(document, &blocks);

    assert!(updated.contains(r#"<w:hyperlink r:id="rId1">"#));
    assert!(updated.contains("<w:t>New</w:t>"));
    assert!(!updated.contains("<w:b/>"));
}

#[test]
fn docx_complex_paragraph_preserves_content_control_when_replacing_text() {
    let document = r#"<w:document><w:body><w:p><w:sdt><w:sdtPr><w:tag w:val="ClientName"/></w:sdtPr><w:sdtContent><w:r><w:t>Old</w:t></w:r></w:sdtContent></w:sdt></w:p></w:body></w:document>"#;
    let blocks = vec![json!({ "text": "New", "italic": true })];

    let updated = replace_docx_blocks(document, &blocks);

    assert!(updated.contains(r#"<w:sdtPr><w:tag w:val="ClientName"/></w:sdtPr>"#));
    assert!(updated.contains("<w:sdtContent>"));
    assert!(updated.contains("<w:t>New</w:t>"));
    assert!(!updated.contains("<w:i/>"));
}

#[test]
fn docx_model_exposes_content_controls() {
    let bytes = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:sdt><w:sdtPr><w:alias w:val="Approval"/><w:tag w:val="ApprovalTag"/><w:id w:val="42"/><w14:checkbox><w14:checked w14:val="0"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:t>No</w:t></w:r></w:sdtContent></w:sdt></w:p><w:p><w:sdt><w:sdtPr><w:dropDownList><w:listItem w:displayText="One" w:value="1"/><w:listItem w:displayText="Two" w:value="2"/></w:dropDownList></w:sdtPr><w:sdtContent><w:r><w:t>One</w:t></w:r></w:sdtContent></w:sdt></w:p></w:body></w:document>"#,
    )]);

    let model = docx_model(&bytes).expect("DOCX content controls should parse");
    let checkbox = &model["blocks"][0]["contentControls"][0];
    let dropdown = &model["blocks"][1]["contentControls"][0];

    assert_eq!(checkbox["kind"], "checkbox");
    assert_eq!(checkbox["alias"], "Approval");
    assert_eq!(checkbox["tag"], "ApprovalTag");
    assert_eq!(checkbox["controlId"], "42");
    assert_eq!(checkbox["checked"], false);
    assert_eq!(checkbox["text"], "No");
    assert_eq!(dropdown["kind"], "dropdown");
    assert_eq!(dropdown["items"][0]["displayText"], "One");
    assert_eq!(dropdown["items"][1]["value"], "2");
}

#[test]
fn docx_update_rewrites_content_control_checkbox_state() {
    let original = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="0"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:t>No</w:t></w:r></w:sdtContent></w:sdt></w:p></w:body></w:document>"#,
    )]);
    let updated = update_docx(
        &original,
        &json!({
            "blocks": [{
                "type": "paragraph",
                "text": "No",
                "contentControls": [{
                    "id": "control1",
                    "kind": "checkbox",
                    "text": "No",
                    "checked": true
                }]
            }]
        }),
    )
    .expect("DOCX content control checkbox should update");

    let document = read_zip_text(&updated, "word/document.xml").unwrap();

    assert!(document.contains(r#"<w14:checked w14:val="1"/>"#));
    assert!(document.contains("<w:sdtContent>"));
}

#[test]
fn docx_update_rewrites_content_control_text() {
    let original = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:sdt><w:sdtPr><w:dropDownList><w:listItem w:displayText="One" w:value="1"/><w:listItem w:displayText="Two" w:value="2"/></w:dropDownList></w:sdtPr><w:sdtContent><w:r><w:t>One</w:t></w:r></w:sdtContent></w:sdt></w:p></w:body></w:document>"#,
    )]);
    let updated = update_docx(
        &original,
        &json!({
            "blocks": [{
                "type": "paragraph",
                "text": "Two",
                "contentControls": [{
                    "id": "control1",
                    "kind": "dropdown",
                    "text": "Two"
                }]
            }]
        }),
    )
    .expect("DOCX content control text should update");

    let document = read_zip_text(&updated, "word/document.xml").unwrap();

    assert!(document.contains(r#"<w:dropDownList>"#));
    assert!(document.contains("<w:sdtContent>"));
    assert!(document.contains("<w:t>Two</w:t>"));
    assert!(!document.contains("<w:t>One</w:t>"));
}

#[test]
fn docx_model_exposes_tracked_revisions() {
    let bytes = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:ins w:id="1" w:author="Elena" w:date="2026-07-08T00:00:00Z"><w:r><w:t>New</w:t></w:r></w:ins><w:del w:id="2" w:author="Elena"><w:r><w:delText>Old</w:delText></w:r></w:del></w:p></w:body></w:document>"#,
    )]);

    let model = docx_model(&bytes).expect("DOCX tracked revisions should parse");
    let insertion = &model["blocks"][0]["revisions"][0];
    let deletion = &model["blocks"][0]["revisions"][1];

    assert_eq!(model["blocks"][0]["text"], "New");
    assert_eq!(insertion["kind"], "insertion");
    assert_eq!(insertion["revisionId"], "1");
    assert_eq!(insertion["author"], "Elena");
    assert_eq!(insertion["date"], "2026-07-08T00:00:00Z");
    assert_eq!(insertion["text"], "New");
    assert_eq!(deletion["kind"], "deletion");
    assert_eq!(deletion["text"], "Old");
}

#[test]
fn docx_update_applies_tracked_revision_actions() {
    let original = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:ins w:id="1"><w:r><w:t>New</w:t></w:r></w:ins><w:del w:id="2"><w:r><w:delText>Old</w:delText></w:r></w:del></w:p></w:body></w:document>"#,
    )]);
    let updated = update_docx(
        &original,
        &json!({
            "blocks": [{
                "type": "paragraph",
                "text": "New",
                "revisions": [
                    { "id": "revision1", "kind": "insertion", "text": "New", "action": "reject" },
                    { "id": "revision2", "kind": "deletion", "text": "Old", "action": "reject" }
                ]
            }]
        }),
    )
    .expect("DOCX tracked revision actions should update");

    let document = read_zip_text(&updated, "word/document.xml").unwrap();

    assert!(!document.contains("<w:ins"));
    assert!(!document.contains("<w:del"));
    assert!(document.contains("<w:t>Old</w:t>"));
    assert!(!document.contains("New"));
}

#[test]
fn docx_complex_paragraph_preserves_move_tracking_when_replacing_text() {
    let document = r#"<w:document><w:body><w:p><w:moveTo w:id="2"><w:r><w:t>Old</w:t></w:r></w:moveTo></w:p></w:body></w:document>"#;
    let blocks = vec![json!({ "text": "New", "underline": true })];

    let updated = replace_docx_blocks(document, &blocks);

    assert!(updated.contains(r#"<w:moveTo w:id="2">"#));
    assert!(updated.contains("<w:t>New</w:t>"));
    assert!(!updated.contains("<w:u"));
}
