use super::super::*;
use super::common::*;

#[test]
fn docx_paragraph_builder_writes_basic_wordprocessor_formatting() {
    let block = json!({
        "type": "heading",
        "headingLevel": 3,
        "text": "Formatted",
        "bold": true,
        "italic": true,
        "underline": true,
        "fontFamily": "Noto Sans",
        "fontSize": "18",
        "verticalAlign": "superscript",
        "color": "#1f2937",
        "align": "justify",
        "highlight": "yellow",
        "indentLeft": 720,
        "spacingBefore": 120,
        "spacingAfter": 240,
        "lineSpacing": 360,
        "pageBreakBefore": true,
    });

    let xml = build_docx_paragraph(&block);

    assert!(xml.contains(r#"<w:pStyle w:val="Heading3"/>"#));
    assert!(xml.contains(r#"<w:jc w:val="justify"/>"#));
    assert!(xml.contains(r#"<w:ind w:left="720"/>"#));
    assert!(
        xml.contains(r#"<w:spacing w:before="120" w:after="240" w:line="360" w:lineRule="auto"/>"#)
    );
    assert!(xml.contains("<w:pageBreakBefore/>"));
    assert!(xml.contains("<w:b/>"));
    assert!(xml.contains("<w:i/>"));
    assert!(xml.contains(r#"<w:u w:val="single"/>"#));
    assert!(xml.contains(r#"<w:vertAlign w:val="superscript"/>"#));
    assert!(xml.contains(r#"<w:rFonts w:ascii="Noto Sans""#));
    assert!(xml.contains(r#"<w:sz w:val="36"/>"#));
    assert!(xml.contains(r#"<w:color w:val="1F2937"/>"#));
    assert!(xml.contains(r#"<w:highlight w:val="yellow"/>"#));
}

#[test]
fn docx_paragraph_builder_writes_line_breaks() {
    let xml = build_docx_paragraph(&json!({
        "type": "paragraph",
        "text": "Line one\nLine two"
    }));

    assert!(xml.contains(
        r#"<w:t xml:space="preserve">Line one</w:t><w:br/><w:t xml:space="preserve">Line two</w:t>"#
    ));
}

#[test]
fn docx_paragraph_builder_writes_note_references() {
    let xml = build_docx_paragraph(&json!({
        "type": "paragraph",
        "text": "Body",
        "footnoteId": "2",
        "endnoteId": "3"
    }));

    assert!(xml.contains(r#"<w:footnoteReference w:id="2"/>"#));
    assert!(xml.contains(r#"<w:endnoteReference w:id="3"/>"#));
    assert!(xml.contains(r#"<w:rStyle w:val="FootnoteReference"/>"#));
    assert!(xml.contains(r#"<w:rStyle w:val="EndnoteReference"/>"#));
}

#[test]
fn docx_paragraph_builder_writes_comment_references() {
    let xml = build_docx_paragraph(&json!({
        "type": "paragraph",
        "text": "Reviewed",
        "commentId": "0"
    }));

    assert!(xml.contains(r#"<w:commentRangeStart w:id="0"/>"#));
    assert!(xml.contains(r#"<w:t xml:space="preserve">Reviewed</w:t>"#));
    assert!(xml.contains(r#"<w:commentRangeEnd w:id="0"/>"#));
    assert!(xml.contains(r#"<w:rStyle w:val="CommentReference"/>"#));
    assert!(xml.contains(r#"<w:commentReference w:id="0"/>"#));
}

#[test]
fn docx_paragraph_builder_writes_bookmarks() {
    let xml = build_docx_paragraph(&json!({
        "type": "paragraph",
        "text": "Bookmarked",
        "bookmarkId": "9",
        "bookmarkName": "Section 1"
    }));

    assert!(xml.contains(r#"<w:bookmarkStart w:id="9" w:name="Section_1"/>"#));
    assert!(xml.contains(r#"<w:t xml:space="preserve">Bookmarked</w:t>"#));
    assert!(xml.contains(r#"<w:bookmarkEnd w:id="9"/>"#));
}

#[test]
fn docx_model_exposes_bookmarks() {
    let bytes = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:bookmarkStart w:id="7" w:name="Intro"/><w:r><w:t>Bookmarked</w:t></w:r><w:bookmarkEnd w:id="7"/></w:p></w:body></w:document>"#,
    )]);

    let model = docx_model(&bytes).expect("DOCX bookmarks should parse");

    assert_eq!(model["blocks"][0]["bookmarkName"], "Intro");
    assert_eq!(model["blocks"][0]["bookmarkId"], "7");
}

#[test]
fn docx_update_assigns_new_bookmark_ids() {
    let original = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:bookmarkStart w:id="4" w:name="Existing"/><w:r><w:t>Old</w:t></w:r><w:bookmarkEnd w:id="4"/></w:p></w:body></w:document>"#,
    )]);
    let model = json!({
        "blocks": [
            { "type": "paragraph", "text": "Existing", "bookmarkId": "4", "bookmarkName": "Existing" },
            { "type": "paragraph", "text": "New", "bookmarkName": "New Mark" }
        ]
    });

    let updated = update_docx(&original, &model).unwrap();
    let document = read_zip_text(&updated, "word/document.xml").unwrap();

    assert!(document.contains(r#"<w:bookmarkStart w:id="4" w:name="Existing"/>"#));
    assert!(document.contains(r#"<w:bookmarkStart w:id="5" w:name="New_Mark"/>"#));
    assert!(document.contains(r#"<w:bookmarkEnd w:id="5"/>"#));
}

#[test]
fn docx_model_exposes_superscript_and_subscript() {
    let bytes = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>Squared</w:t></w:r></w:p><w:p><w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>Base</w:t></w:r></w:p></w:body></w:document>"#,
    )]);

    let model = docx_model(&bytes).expect("DOCX vertical align model should parse");

    assert_eq!(model["blocks"][0]["verticalAlign"], "superscript");
    assert_eq!(model["blocks"][1]["verticalAlign"], "subscript");
}

#[test]
fn docx_model_exposes_page_breaks() {
    let bytes = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>Before</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>After</w:t></w:r></w:p></w:body></w:document>"#,
    )]);

    let model = docx_model(&bytes).expect("DOCX page break model should parse");

    assert_eq!(model["blocks"][0]["text"], "Before");
    assert_eq!(model["blocks"][0]["pageBreakBefore"], true);
    assert_eq!(model["blocks"][1]["type"], "pageBreak");
    assert_eq!(model["blocks"][2]["text"], "After");
}

#[test]
fn docx_update_writes_page_break_blocks() {
    let original = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:r><w:t>Old</w:t></w:r></w:p></w:body></w:document>"#,
    )]);
    let model = json!({
        "blocks": [
            { "type": "paragraph", "text": "Before" },
            { "type": "pageBreak", "text": "" },
            { "type": "paragraph", "text": "After" }
        ]
    });

    let updated = update_docx(&original, &model).unwrap();
    let document = read_zip_text(&updated, "word/document.xml").unwrap();

    assert!(document.contains("<w:t xml:space=\"preserve\">Before</w:t>"));
    assert!(document.contains(r#"<w:br w:type="page"/>"#));
    assert!(document.contains("<w:t xml:space=\"preserve\">After</w:t>"));
}

#[test]
fn docx_model_exposes_section_breaks() {
    let bytes = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:r><w:t>Before</w:t></w:r></w:p><w:p><w:pPr><w:sectPr><w:type w:val="continuous"/></w:sectPr></w:pPr></w:p><w:p><w:r><w:t>After</w:t></w:r></w:p></w:body></w:document>"#,
    )]);

    let model = docx_model(&bytes).expect("DOCX section break model should parse");

    assert_eq!(model["blocks"][1]["type"], "sectionBreak");
    assert_eq!(model["blocks"][1]["breakKind"], "continuous");
}

#[test]
fn docx_update_writes_section_break_blocks() {
    let original = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:r><w:t>Old</w:t></w:r></w:p></w:body></w:document>"#,
    )]);
    let model = json!({
        "blocks": [
            { "type": "paragraph", "text": "Before" },
            { "type": "sectionBreak", "text": "", "breakKind": "nextPage" },
            { "type": "paragraph", "text": "After" }
        ]
    });

    let updated = update_docx(&original, &model).unwrap();
    let document = read_zip_text(&updated, "word/document.xml").unwrap();

    assert!(document.contains("<w:t xml:space=\"preserve\">Before</w:t>"));
    assert!(document.contains(r#"<w:sectPr><w:type w:val="nextPage"/></w:sectPr>"#));
    assert!(document.contains("<w:t xml:space=\"preserve\">After</w:t>"));
}

#[test]
fn docx_model_exposes_hyperlink_targets() {
    let bytes = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:hyperlink r:id="rId5"><w:r><w:t>Docs</w:t></w:r></w:hyperlink></w:p></w:body></w:document>"#,
        ),
        (
            "word/_rels/document.xml.rels",
            r#"<Relationships><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/docs" TargetMode="External"/></Relationships>"#,
        ),
    ]);

    let model = docx_model(&bytes).expect("DOCX hyperlink model should parse");
    let block = &model["blocks"][0];

    assert_eq!(block["text"], "Docs");
    assert_eq!(block["relationshipId"], "rId5");
    assert_eq!(block["target"], "https://example.com/docs");
}

#[test]
fn docx_update_writes_new_hyperlink_relationship() {
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
    let model = json!({
        "blocks": [
            {
                "type": "paragraph",
                "text": "Docs",
                "target": "https://example.com/docs"
            }
        ]
    });

    let updated = update_docx(&original, &model).unwrap();
    let document = read_zip_text(&updated, "word/document.xml").unwrap();
    let rels = read_zip_text(&updated, "word/_rels/document.xml.rels").unwrap();

    assert!(document.contains("xmlns:r="));
    assert!(document.contains(r#"<w:hyperlink r:id="rId1">"#));
    assert!(document.contains("<w:t xml:space=\"preserve\">Docs</w:t>"));
    assert!(rels.contains("relationships/hyperlink"));
    assert!(rels.contains(r#"Target="https://example.com/docs""#));
    assert!(rels.contains(r#"TargetMode="External""#));
}

#[test]
fn docx_model_exposes_inline_images() {
    let bytes = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/><wp:docPr id="1" name="Picture 1" descr="Diagram"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId7"/><a:srcRect l="5000" t="10000" r="15000" b="20000"/></pic:blipFill><pic:spPr><a:xfrm rot="2700000"><a:ext cx="952500" cy="476250"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>"#,
        ),
        (
            "word/_rels/document.xml.rels",
            r#"<Relationships><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>"#,
        ),
        ("word/media/image1.png", "png-bytes"),
    ]);

    let model = docx_model(&bytes).expect("DOCX image model should parse");
    let block = &model["blocks"][0];

    assert_eq!(block["type"], "image");
    assert_eq!(block["relationshipId"], "rId7");
    assert_eq!(block["mediaPath"], "word/media/image1.png");
    assert_eq!(block["mimeType"], "image/png");
    assert_eq!(block["width"], 100);
    assert_eq!(block["height"], 50);
    assert_eq!(block["imageRotation"], 45);
    assert_eq!(block["imageCropLeft"], 5.0);
    assert_eq!(block["imageCropTop"], 10.0);
    assert_eq!(block["imageCropRight"], 15.0);
    assert_eq!(block["imageCropBottom"], 20.0);
    assert_eq!(block["imageWrap"], "inline");
    assert_eq!(block["altText"], "Diagram");
    assert!(block["dataUrl"]
        .as_str()
        .expect("image data URL")
        .starts_with("data:image/png;base64,"));
}

#[test]
fn docx_image_block_updates_extent_and_alt_text() {
    let source_xml = r#"<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/><wp:docPr id="1" name="Picture 1" descr="Diagram"/><a:graphic><a:graphicData><pic:pic><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="476250"/></a:xfrm></pic:spPr><pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#;
    let block = json!({
        "type": "image",
        "relationshipId": "rId7",
        "width": 120,
        "height": 80,
        "imageRotation": 90,
        "imageCropLeft": 2.5,
        "imageCropTop": 5,
        "imageCropRight": 7.5,
        "imageCropBottom": 10,
        "altText": "Updated diagram",
        "sourceXml": source_xml,
    });

    let xml = build_docx_image_paragraph(&block);

    assert!(xml.contains(r#"<wp:extent cx="1143000" cy="762000"/>"#));
    assert!(xml.contains(r#"<a:ext cx="1143000" cy="762000"/>"#));
    assert!(xml.contains(r#"descr="Updated diagram""#));
    assert!(xml.contains(r#"title="Updated diagram""#));
    assert!(xml.contains(r#"<a:xfrm rot="5400000">"#));
    assert!(xml.contains(r#"<a:srcRect l="2500" t="5000" r="7500" b="10000"/>"#));
    assert!(xml.contains(r#"r:embed="rId7""#));
}

#[test]
fn docx_image_block_writes_anchor_wrap_modes() {
    let block = json!({
        "type": "image",
        "relationshipId": "rId7",
        "width": 120,
        "height": 80,
        "imageWrap": "square",
        "altText": "Wrapped diagram"
    });

    let xml = build_docx_image_paragraph(&block);

    assert!(xml.contains("<wp:anchor"));
    assert!(xml.contains(r#"behindDoc="0""#));
    assert!(xml.contains(r#"<wp:wrapSquare wrapText="bothSides"/>"#));
    assert!(xml.contains(r#"descr="Wrapped diagram""#));

    let behind_xml = build_docx_image_paragraph(&json!({
        "type": "image",
        "relationshipId": "rId7",
        "width": 120,
        "height": 80,
        "imageWrap": "behind"
    }));
    assert!(behind_xml.contains(r#"behindDoc="1""#));
    assert!(behind_xml.contains("<wp:wrapNone/>"));
}

#[test]
fn docx_model_exposes_anchor_image_wrap() {
    let bytes = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:drawing><wp:anchor behindDoc="0"><wp:extent cx="952500" cy="476250"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="Picture 1"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill><pic:spPr><a:xfrm><a:ext cx="952500" cy="476250"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p></w:body></w:document>"#,
        ),
        (
            "word/_rels/document.xml.rels",
            r#"<Relationships><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>"#,
        ),
        ("word/media/image1.png", "png-bytes"),
    ]);

    let model = docx_model(&bytes).expect("DOCX anchor image model should parse");

    assert_eq!(model["blocks"][0]["imageWrap"], "square");
}

#[test]
fn docx_inserted_image_adds_media_relationship_and_content_type() {
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
                { "type": "paragraph", "text": "Item", "listKind": "bullet" },
                {
                    "type": "image",
                    "text": "",
                    "dataUrl": "data:image/png;base64,cG5nLWJ5dGVz",
                    "width": 120,
                    "height": 80,
                    "altText": "Inserted"
                }
            ]
        }),
    )
    .expect("DOCX image should insert");

    let document = read_zip_text(&updated, "word/document.xml").unwrap();
    let rels = read_zip_text(&updated, "word/_rels/document.xml.rels").unwrap();
    let content_types = read_zip_text(&updated, "[Content_Types].xml").unwrap();
    let media = read_zip_bytes(&updated, "word/media/mymy-image-1.png").unwrap();

    assert_eq!(media, b"png-bytes");
    assert!(document.contains(r#"r:embed="rId1""#));
    assert!(document.contains(r#"descr="Inserted""#));
    assert!(rels.contains("relationships/image"));
    assert!(rels.contains(r#"Target="media/mymy-image-1.png""#));
    assert!(rels.contains("relationships/numbering"));
    assert!(content_types.contains(r#"Extension="png" ContentType="image/png""#));
    assert!(content_types.contains(r#"PartName="/word/numbering.xml""#));
}

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

#[test]
fn docx_page_settings_read_and_update_section_properties() {
    let document = r#"<w:document><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>"#;
    let page = docx_page_settings(document);

    assert_eq!(page["width"], 12240);
    assert_eq!(page["height"], 15840);
    assert_eq!(page["marginTop"], 1440);

    let updated = update_docx_page_settings(
        document,
        Some(&json!({
            "orientation": "landscape",
            "width": 15840,
            "height": 12240,
            "marginTop": 720,
            "marginRight": 1080,
            "marginBottom": 720,
            "marginLeft": 1080
        })),
    );

    assert!(updated.contains(r#"<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>"#));
    assert!(
        updated.contains(r#"<w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080"/>"#)
    );
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
fn docx_numbering_formats_map_num_ids_to_list_kinds() {
    let numbering = ensure_docx_basic_numbering_xml("");
    let formats = docx_numbering_formats(&numbering);

    assert_eq!(formats.get(DOCX_BULLET_NUM_ID), Some(&"bullet".to_string()));
    assert_eq!(formats.get(DOCX_NUMBER_NUM_ID), Some(&"number".to_string()));
}

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
fn docx_table_rows_parse_and_save_basic_cells() {
    let table = r##"<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblBorders><w:top w:val="single" w:sz="6" w:space="0" w:color="1F2937"/></w:tblBorders></w:tblPr><w:tr><w:trPr><w:trHeight w:val="420" w:hRule="atLeast"/><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DBEAFE"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DBEAFE"/></w:tcPr><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:trPr><w:trHeight w:val="600" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/></w:tcPr><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"##;

    let rows = parse_docx_table_rows(table);
    assert_eq!(
        rows,
        vec![
            vec!["A1".to_string(), "B1".to_string()],
            vec!["A2".to_string(), "B2".to_string()],
        ]
    );
    assert_eq!(parse_docx_table_column_widths(table), vec![1800, 3000]);
    assert_eq!(parse_docx_table_row_heights(table), vec![420, 600]);
    assert_eq!(parse_docx_table_style(table), Some("TableGrid".to_string()));
    assert_eq!(
        parse_docx_table_border_color(table),
        Some("#1F2937".to_string())
    );
    assert_eq!(parse_docx_table_border_size(table), Some(6));
    assert_eq!(
        parse_docx_table_cell_background(table),
        Some("#FFFFFF".to_string())
    );
    assert!(parse_docx_table_header_row(table));
    assert_eq!(
        parse_docx_table_header_background(table),
        Some("#DBEAFE".to_string())
    );
    assert_eq!(parse_docx_table_cell_vertical_align(table), Some("center"));

    let xml = build_docx_table(&json!({
        "type": "table",
        "rows": [["C1", "D1"], ["C2", "D2\nD3"]],
        "tableColumnWidths": [1800, 3000],
        "tableRowHeights": [420, 600],
        "tableStyle": "TableGrid",
        "tableBorderColor": "#1F2937",
        "tableBorderSize": 6,
        "tableCellBackground": "#FFFFFF",
        "tableHeaderRow": true,
        "tableHeaderBackground": "#DBEAFE",
        "tableCellVerticalAlign": "center"
    }));
    assert!(xml.contains("<w:tbl>"));
    assert!(xml.contains(r#"<w:tblStyle w:val="TableGrid"/>"#));
    assert!(xml.contains(r#"<w:top w:val="single" w:sz="6" w:space="0" w:color="1F2937"/>"#));
    assert!(xml.contains(r#"<w:tcW w:w="1800" w:type="dxa"/>"#));
    assert!(xml.contains(r#"<w:tcW w:w="3000" w:type="dxa"/>"#));
    assert!(xml.contains(r#"<w:trHeight w:val="420" w:hRule="atLeast"/>"#));
    assert!(xml.contains(r#"<w:trHeight w:val="600" w:hRule="atLeast"/>"#));
    assert!(xml.contains("<w:tblHeader/>"));
    assert!(xml.contains(r#"<w:shd w:val="clear" w:color="auto" w:fill="DBEAFE"/>"#));
    assert!(xml.contains(r#"<w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/>"#));
    assert!(xml.contains(r#"<w:vAlign w:val="center"/>"#));
    assert!(xml.contains("<w:t xml:space=\"preserve\">C1</w:t>"));
    assert!(xml.contains("<w:t xml:space=\"preserve\">D2</w:t>"));
    assert!(xml.contains("<w:br/><w:t xml:space=\"preserve\">D3</w:t>"));
}

#[test]
fn docx_table_merged_cells_parse_and_save() {
    let table = r#"<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>C1</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>C2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"#;

    let merged_cells = parse_docx_table_merged_cells(table);
    assert_eq!(
        merged_cells,
        vec![json!({"row": 0, "column": 0, "rowSpan": 2, "colSpan": 2})]
    );

    let xml = build_docx_table(&json!({
        "type": "table",
        "rows": [["A1", "", "C1"], ["", "", "C2"]],
        "tableColumnWidths": [1200, 1300, 1400],
        "tableMergedCells": [{"row": 0, "column": 0, "rowSpan": 2, "colSpan": 2}]
    }));
    assert!(xml.contains(r#"<w:gridSpan w:val="2"/>"#));
    assert!(xml.contains(r#"<w:vMerge w:val="restart"/>"#));
    assert!(xml.contains("<w:vMerge/>"));
    assert!(xml.contains(r#"<w:tcW w:w="2500" w:type="dxa"/>"#));
}

#[test]
fn docx_replace_blocks_handles_paragraph_and_table_order() {
    let document = r#"<w:document><w:body><w:p><w:r><w:t>Old paragraph</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Old cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#;
    let blocks = vec![
        json!({ "type": "paragraph", "text": "New paragraph" }),
        json!({ "type": "table", "rows": [["New cell"]] }),
    ];

    let updated = replace_docx_blocks(document, &blocks);

    assert!(updated.contains("<w:t xml:space=\"preserve\">New paragraph</w:t>"));
    assert!(updated.contains("<w:t xml:space=\"preserve\">New cell</w:t>"));
}
