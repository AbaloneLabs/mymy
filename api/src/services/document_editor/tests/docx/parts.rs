use super::super::super::*;
use super::super::common::*;

#[test]
fn docx_model_exposes_header_and_footer_text_parts() {
    let bytes = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>"#,
        ),
        (
            "word/header1.xml",
            r#"<w:hdr><w:p><w:r><w:t>Header one</w:t></w:r></w:p><w:p><w:r><w:t>Header two</w:t></w:r></w:p></w:hdr>"#,
        ),
        (
            "word/footer1.xml",
            r#"<w:ftr><w:p><w:r><w:t>Footer</w:t></w:r></w:p></w:ftr>"#,
        ),
    ]);

    let model = docx_model(&bytes).expect("DOCX text parts should parse");

    assert_eq!(model["headers"][0]["path"], "word/header1.xml");
    assert_eq!(model["headers"][0]["text"], "Header one\nHeader two");
    assert_eq!(model["footers"][0]["path"], "word/footer1.xml");
    assert_eq!(model["footers"][0]["text"], "Footer");
}

#[test]
fn docx_model_exposes_footer_page_fields_as_tokens() {
    let bytes = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>"#,
        ),
        (
            "word/footer1.xml",
            r#"<w:ftr><w:p><w:r><w:t>Page </w:t></w:r><w:fldSimple w:instr=" PAGE \* MERGEFORMAT "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>"#,
        ),
    ]);

    let model = docx_model(&bytes).expect("DOCX footer page fields should parse");

    assert_eq!(model["footers"][0]["text"], "Page {PAGE}");
}

#[test]
fn docx_update_rewrites_existing_header_and_footer_parts() {
    let original = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>Old body</w:t></w:r></w:p></w:body></w:document>"#,
        ),
        (
            "word/header1.xml",
            r#"<w:hdr><w:p><w:r><w:t>Old header</w:t></w:r></w:p></w:hdr>"#,
        ),
        (
            "word/footer1.xml",
            r#"<w:ftr><w:p><w:r><w:t>Old footer</w:t></w:r></w:p></w:ftr>"#,
        ),
    ]);
    let updated = update_docx(
        &original,
        &json!({
            "blocks": [{ "type": "paragraph", "text": "New body" }],
            "headers": [{ "path": "word/header1.xml", "text": "New header\nSecond line" }],
            "footers": [{ "path": "word/footer1.xml", "text": "New footer" }]
        }),
    )
    .expect("DOCX should update text parts");

    let document = read_zip_text(&updated, "word/document.xml").unwrap();
    let header = read_zip_text(&updated, "word/header1.xml").unwrap();
    let footer = read_zip_text(&updated, "word/footer1.xml").unwrap();

    assert!(document.contains("New body"));
    assert!(header.contains("New header"));
    assert!(header.contains("Second line"));
    assert!(footer.contains("New footer"));
}

#[test]
fn docx_update_writes_footer_page_fields() {
    let original = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>Old body</w:t></w:r></w:p></w:body></w:document>"#,
        ),
        (
            "word/footer1.xml",
            r#"<w:ftr><w:p><w:r><w:t>Old footer</w:t></w:r></w:p></w:ftr>"#,
        ),
    ]);
    let updated = update_docx(
        &original,
        &json!({
            "blocks": [{ "type": "paragraph", "text": "Body" }],
            "footers": [{ "path": "word/footer1.xml", "text": "Page {PAGE}" }]
        }),
    )
    .expect("DOCX should write page fields");

    let footer = read_zip_text(&updated, "word/footer1.xml").unwrap();

    assert!(footer.contains(">Page <"));
    assert!(footer.contains(r#"<w:fldSimple w:instr=" PAGE \* MERGEFORMAT ">"#));
    assert!(footer.contains(r#"<w:t>1</w:t>"#));
}

#[test]
fn docx_model_exposes_existing_comments() {
    let bytes = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>"#,
        ),
        (
            "word/comments.xml",
            r#"<w:comments><w:comment w:id="0" w:author="Elena" w:date="2026-07-06T10:00:00Z"><w:p><w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:comment></w:comments>"#,
        ),
    ]);

    let model = docx_model(&bytes).expect("DOCX comments should parse");
    let comment = &model["comments"][0];

    assert_eq!(comment["id"], "0");
    assert_eq!(comment["author"], "Elena");
    assert_eq!(comment["date"], "2026-07-06T10:00:00Z");
    assert_eq!(comment["text"], "First\nSecond");
}

#[test]
fn docx_model_exposes_body_comment_references() {
    let bytes = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Reviewed</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p></w:body></w:document>"#,
    )]);

    let model = docx_model(&bytes).expect("DOCX comment references should parse");

    assert_eq!(model["blocks"][0]["text"], "Reviewed");
    assert_eq!(model["blocks"][0]["commentId"], "0");
}

#[test]
fn docx_update_rewrites_existing_comments() {
    let original = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>"#,
        ),
        (
            "word/comments.xml",
            r#"<w:comments><w:comment w:id="0" w:author="Old" w:date="2026-07-06T10:00:00Z"><w:p><w:r><w:t>Old comment</w:t></w:r></w:p></w:comment></w:comments>"#,
        ),
    ]);
    let updated = update_docx(
        &original,
        &json!({
            "blocks": [{ "type": "paragraph", "text": "Body" }],
            "comments": [{
                "id": "0",
                "author": "New Author",
                "date": "2026-07-06T11:00:00Z",
                "text": "Updated comment\nSecond line"
            }]
        }),
    )
    .expect("DOCX should update comments");

    let comments = read_zip_text(&updated, "word/comments.xml").unwrap();

    assert!(comments.contains(r#"w:author="New Author""#));
    assert!(comments.contains(r#"w:date="2026-07-06T11:00:00Z""#));
    assert!(comments.contains(">Updated comment<"));
    assert!(comments.contains(">Second line<"));
    assert!(!comments.contains("Old comment"));
}

#[test]
fn docx_update_adds_comments_part_relationship_and_content_type() {
    let original = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>Old</w:t></w:r></w:p></w:body></w:document>"#,
        ),
        (
            "word/_rels/document.xml.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#,
        ),
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
        ),
    ]);
    let updated = update_docx(
        &original,
        &json!({
            "blocks": [{ "type": "paragraph", "text": "Reviewed", "commentId": "0" }],
            "comments": [{ "id": "0", "author": "Elena", "text": "Please revise" }]
        }),
    )
    .expect("DOCX should add comments part");

    let document = read_zip_text(&updated, "word/document.xml").unwrap();
    let comments = read_zip_text(&updated, "word/comments.xml").unwrap();
    let rels = read_zip_text(&updated, "word/_rels/document.xml.rels").unwrap();
    let content_types = read_zip_text(&updated, "[Content_Types].xml").unwrap();

    assert!(document.contains(r#"<w:commentRangeStart w:id="0"/>"#));
    assert!(document.contains(r#"<w:commentReference w:id="0"/>"#));
    assert!(comments.contains(r#"<w:comment w:id="0" w:author="Elena">"#));
    assert!(comments.contains(">Please revise<"));
    assert!(rels.contains("relationships/comments"));
    assert!(rels.contains(r#"Target="comments.xml""#));
    assert!(content_types.contains(r#"PartName="/word/comments.xml""#));
    assert!(content_types
        .contains("application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"));
}

#[test]
fn docx_model_exposes_existing_footnotes_and_endnotes() {
    let bytes = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>"#,
        ),
        (
            "word/footnotes.xml",
            r#"<w:footnotes><w:footnote w:id="-1"><w:p><w:r><w:t>Separator</w:t></w:r></w:p></w:footnote><w:footnote w:id="2"><w:p><w:r><w:t>Foot one</w:t></w:r></w:p><w:p><w:r><w:t>Foot two</w:t></w:r></w:p></w:footnote></w:footnotes>"#,
        ),
        (
            "word/endnotes.xml",
            r#"<w:endnotes><w:endnote w:id="3"><w:p><w:r><w:t>End note</w:t></w:r></w:p></w:endnote></w:endnotes>"#,
        ),
    ]);

    let model = docx_model(&bytes).expect("DOCX notes should parse");

    assert_eq!(model["footnotes"].as_array().unwrap().len(), 1);
    assert_eq!(model["footnotes"][0]["id"], "2");
    assert_eq!(model["footnotes"][0]["kind"], "footnote");
    assert_eq!(model["footnotes"][0]["text"], "Foot one\nFoot two");
    assert_eq!(model["endnotes"][0]["id"], "3");
    assert_eq!(model["endnotes"][0]["kind"], "endnote");
    assert_eq!(model["endnotes"][0]["text"], "End note");
}

#[test]
fn docx_model_exposes_body_note_references() {
    let bytes = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:r><w:t>Footed</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r></w:p><w:p><w:r><w:t>Ended</w:t></w:r><w:r><w:endnoteReference w:id="3"/></w:r></w:p></w:body></w:document>"#,
    )]);

    let model = docx_model(&bytes).expect("DOCX note references should parse");

    assert_eq!(model["blocks"][0]["footnoteId"], "2");
    assert_eq!(model["blocks"][1]["endnoteId"], "3");
}

#[test]
fn docx_update_rewrites_existing_footnotes_and_endnotes() {
    let original = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>"#,
        ),
        (
            "word/footnotes.xml",
            r#"<w:footnotes><w:footnote w:id="2"><w:p><w:r><w:t>Old foot</w:t></w:r></w:p></w:footnote></w:footnotes>"#,
        ),
        (
            "word/endnotes.xml",
            r#"<w:endnotes><w:endnote w:id="3"><w:p><w:r><w:t>Old end</w:t></w:r></w:p></w:endnote></w:endnotes>"#,
        ),
    ]);
    let updated = update_docx(
        &original,
        &json!({
            "blocks": [{ "type": "paragraph", "text": "Body" }],
            "footnotes": [{ "id": "2", "text": "New foot\nSecond foot" }],
            "endnotes": [{ "id": "3", "text": "New end" }]
        }),
    )
    .expect("DOCX should update notes");

    let footnotes = read_zip_text(&updated, "word/footnotes.xml").unwrap();
    let endnotes = read_zip_text(&updated, "word/endnotes.xml").unwrap();

    assert!(footnotes.contains(">New foot<"));
    assert!(footnotes.contains(">Second foot<"));
    assert!(!footnotes.contains("Old foot"));
    assert!(endnotes.contains(">New end<"));
    assert!(!endnotes.contains("Old end"));
}

#[test]
fn docx_update_adds_footnotes_part_relationship_and_content_type() {
    let original = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>Old</w:t></w:r></w:p></w:body></w:document>"#,
        ),
        (
            "word/_rels/document.xml.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#,
        ),
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
        ),
    ]);
    let updated = update_docx(
        &original,
        &json!({
            "blocks": [{ "type": "paragraph", "text": "Body", "footnoteId": "2" }],
            "footnotes": [{ "id": "2", "text": "New footnote\nSecond line" }]
        }),
    )
    .expect("DOCX should add footnotes part");

    let document = read_zip_text(&updated, "word/document.xml").unwrap();
    let footnotes = read_zip_text(&updated, "word/footnotes.xml").unwrap();
    let rels = read_zip_text(&updated, "word/_rels/document.xml.rels").unwrap();
    let content_types = read_zip_text(&updated, "[Content_Types].xml").unwrap();

    assert!(document.contains(r#"<w:footnoteReference w:id="2"/>"#));
    assert!(footnotes.contains(r#"<w:footnote w:id="2">"#));
    assert!(footnotes.contains(">New footnote<"));
    assert!(footnotes.contains(">Second line<"));
    assert!(rels.contains("relationships/footnotes"));
    assert!(rels.contains(r#"Target="footnotes.xml""#));
    assert!(content_types.contains(r#"PartName="/word/footnotes.xml""#));
    assert!(content_types
        .contains("application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"));
}
