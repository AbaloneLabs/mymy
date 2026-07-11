use super::super::super::*;
use super::super::common::*;

#[test]
fn docx_run_properties_require_exact_element_names() {
    let bytes = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:pPr><w:ind w:left="0"/></w:pPr><w:r><w:instrText>REF Item</w:instrText><w:t>Heading</w:t></w:r></w:p></w:body></w:document>"#,
    )]);

    let model = docx_model(&bytes).expect("DOCX run properties should parse");
    let block = &model["blocks"][0];

    assert_eq!(block["italic"], false);
    assert_eq!(block["indentLeft"], 0);
    assert!(block["runs"][0].get("italic").is_none());
}

#[test]
fn docx_zero_indent_survives_an_edited_paragraph_round_trip() {
    let original = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:pPr><w:ind w:left="0"/></w:pPr><w:r><w:t>Before</w:t></w:r></w:p></w:body></w:document>"#,
    )]);
    let mut model = docx_model(&original).unwrap();
    model["blocks"][0]["text"] = json!("After");
    model["blocks"][0].as_object_mut().unwrap().remove("runs");

    let updated = update_docx(&original, &model).unwrap();
    let reopened = docx_model(&updated).unwrap();

    assert_eq!(reopened["blocks"][0]["text"], "After");
    assert_eq!(reopened["blocks"][0]["indentLeft"], 0);
    assert_eq!(reopened["blocks"][0]["italic"], false);
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
fn docx_model_exposes_paragraph_pagination_properties() {
    let bytes = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:pPr><w:pageBreakBefore/><w:keepNext/><w:keepLines/></w:pPr><w:r><w:t>Stable paragraph</w:t></w:r></w:p></w:body></w:document>"#,
    )]);

    let model = docx_model(&bytes).expect("DOCX pagination should parse");

    assert_eq!(model["blocks"][0]["pageBreakBefore"], true);
    assert_eq!(model["blocks"][0]["keepWithNext"], true);
    assert_eq!(model["blocks"][0]["keepLinesTogether"], true);
}

#[test]
fn docx_model_exposes_simple_and_complex_fields() {
    let bytes = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:r><w:t>Figure </w:t></w:r><w:fldSimple w:instr=" SEQ Figure \* ARABIC "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> REF _Ref1 \h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Heading</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:body></w:document>"#,
    )]);

    let model = docx_model(&bytes).expect("DOCX fields should parse");

    assert_eq!(model["blocks"][0]["fields"][0]["source"], "simple");
    assert_eq!(model["blocks"][0]["fields"][0]["kind"], "SEQ");
    assert_eq!(
        model["blocks"][0]["fields"][0]["instruction"],
        "SEQ Figure \\* ARABIC"
    );
    assert_eq!(model["blocks"][0]["fields"][0]["resultText"], "1");
    assert_eq!(model["blocks"][1]["fields"][0]["source"], "complex");
    assert_eq!(model["blocks"][1]["fields"][0]["kind"], "REF");
    assert_eq!(
        model["blocks"][1]["fields"][0]["instruction"],
        "REF _Ref1 \\h"
    );
}

#[test]
fn docx_update_rewrites_simple_field_instruction_without_rebuilding_field() {
    let original = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:r><w:t>Figure </w:t></w:r><w:fldSimple w:instr=" SEQ Figure \* ARABIC "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:body></w:document>"#,
    )]);
    let updated = update_docx(
        &original,
        &json!({
            "blocks": [{
                "type": "paragraph",
                "text": "Figure 1",
                "fields": [{
                    "id": "simple1",
                    "source": "simple",
                    "kind": "SEQ",
                    "instruction": "SEQ Table \\* ARABIC",
                    "resultText": "1"
                }]
            }]
        }),
    )
    .expect("DOCX simple field instruction should update");

    let document = read_zip_text(&updated, "word/document.xml").unwrap();

    assert!(document.contains(r#"<w:fldSimple w:instr="SEQ Table \* ARABIC">"#));
    assert!(document.contains("</w:fldSimple>"));
}

#[test]
fn docx_model_exposes_paragraph_style_catalog_and_block_style() {
    let bytes = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="QuoteStyle"/></w:pPr><w:r><w:t>Styled</w:t></w:r></w:p></w:body></w:document>"#,
        ),
        (
            "word/styles.xml",
            r##"<w:styles><w:style w:type="paragraph" w:styleId="QuoteStyle" w:customStyle="1"><w:name w:val="Quote Style"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:rFonts w:ascii="Noto Serif"/><w:sz w:val="30"/><w:b/><w:i/><w:color w:val="1F2937"/></w:rPr></w:style></w:styles>"##,
        ),
    ]);

    let model = docx_model(&bytes).expect("DOCX paragraph styles should parse");
    let block = &model["blocks"][0];
    let style = &model["styles"][0];

    assert_eq!(block["paragraphStyleId"], "QuoteStyle");
    assert_eq!(block["paragraphStyleName"], "Quote Style");
    assert_eq!(style["id"], "QuoteStyle");
    assert_eq!(style["name"], "Quote Style");
    assert_eq!(style["custom"], true);
    assert_eq!(style["quickFormat"], true);
    assert_eq!(style["basedOn"], "Normal");
    assert_eq!(style["next"], "Normal");
    assert_eq!(style["fontFamily"], "Noto Serif");
    assert_eq!(style["fontSize"], "15");
    assert_eq!(style["bold"], true);
    assert_eq!(style["italic"], true);
    assert_eq!(style["color"], "#1F2937");
    assert_eq!(style["align"], "center");
}

#[test]
fn docx_paragraph_builder_writes_custom_paragraph_style() {
    let xml = build_docx_paragraph(&json!({
        "type": "paragraph",
        "text": "Styled",
        "paragraphStyleId": "QuoteStyle"
    }));

    assert!(xml.contains(r#"<w:pStyle w:val="QuoteStyle"/>"#));
    assert!(xml.contains(r#"<w:t xml:space="preserve">Styled</w:t>"#));
}

#[test]
fn docx_update_writes_edited_and_new_paragraph_styles() {
    let original = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="QuoteStyle"/></w:pPr><w:r><w:t>Styled</w:t></w:r></w:p></w:body></w:document>"#,
        ),
        (
            "word/styles.xml",
            r#"<w:styles><w:style w:type="paragraph" w:styleId="QuoteStyle"><w:name w:val="Quote Style"/></w:style></w:styles>"#,
        ),
        (
            "word/_rels/document.xml.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#,
        ),
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>"#,
        ),
    ]);

    let updated = update_docx(
        &original,
        &json!({
            "blocks": [{
                "type": "paragraph",
                "text": "Styled",
                "paragraphStyleId": "NewStyle"
            }],
            "styles": [
                {
                    "id": "QuoteStyle",
                    "name": "Quote Style",
                    "type": "paragraph",
                    "custom": true,
                    "fontFamily": "Noto Serif",
                    "fontSize": "15",
                    "bold": true,
                    "color": "#1f2937",
                    "align": "center"
                },
                {
                    "id": "NewStyle",
                    "name": "New Style",
                    "type": "paragraph",
                    "custom": true,
                    "basedOn": "QuoteStyle",
                    "next": "Normal",
                    "quickFormat": true,
                    "italic": true
                }
            ]
        }),
    )
    .expect("DOCX paragraph styles should save");

    let styles = read_zip_text(&updated, "word/styles.xml").unwrap();
    let rels = read_zip_text(&updated, "word/_rels/document.xml.rels").unwrap();
    let content_types = read_zip_text(&updated, "[Content_Types].xml").unwrap();
    let document = read_zip_text(&updated, "word/document.xml").unwrap();

    assert!(styles.contains(r#"w:styleId="QuoteStyle""#));
    assert!(styles.contains(r#"w:customStyle="1""#));
    assert!(styles.contains(r#"<w:rFonts w:ascii="Noto Serif""#));
    assert!(styles.contains(r#"<w:sz w:val="30"/>"#));
    assert!(styles.contains(r#"<w:color w:val="1F2937"/>"#));
    assert!(styles.contains(r#"<w:style w:type="paragraph" w:styleId="NewStyle""#));
    assert!(styles.contains(r#"<w:basedOn w:val="QuoteStyle"/>"#));
    assert!(styles.contains("<w:qFormat/>"));
    assert!(document.contains(r#"<w:pStyle w:val="NewStyle"/>"#));
    assert!(rels.contains("relationships/styles"));
    assert!(content_types.contains(r#"PartName="/word/styles.xml""#));
}

#[test]
fn docx_update_writes_used_fonts_to_font_table() {
    let original = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>Styled Run</w:t></w:r></w:p></w:body></w:document>"#,
        ),
        (
            "word/fontTable.xml",
            r#"<w:fonts><w:font w:name="Existing Font"/></w:fonts>"#,
        ),
        (
            "word/_rels/document.xml.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#,
        ),
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>"#,
        ),
    ]);

    let updated = update_docx(
        &original,
        &json!({
            "blocks": [{
                "type": "paragraph",
                "text": "Styled Run",
                "fontFamily": "Noto Sans",
                "runs": [
                    { "text": "Styled ", "fontFamily": "Noto Serif" },
                    { "text": "Run", "fontFamily": "Noto Sans Mono" }
                ]
            }],
            "styles": [{
                "id": "CodeStyle",
                "name": "Code Style",
                "type": "paragraph",
                "fontFamily": "Liberation Mono"
            }]
        }),
    )
    .expect("DOCX font table should save");

    let font_table = read_zip_text(&updated, "word/fontTable.xml").unwrap();
    let rels = read_zip_text(&updated, "word/_rels/document.xml.rels").unwrap();
    let content_types = read_zip_text(&updated, "[Content_Types].xml").unwrap();

    assert!(font_table.contains(r#"w:name="Existing Font""#));
    assert!(font_table.contains(r#"w:name="Noto Sans""#));
    assert!(font_table.contains(r#"w:name="Noto Serif""#));
    assert!(font_table.contains(r#"w:name="Noto Sans Mono""#));
    assert!(font_table.contains(r#"w:name="Liberation Mono""#));
    assert!(rels.contains("relationships/fontTable"));
    assert!(content_types.contains(r#"PartName="/word/fontTable.xml""#));
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
fn docx_model_exposes_run_level_formatting() {
    let bytes = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:r><w:rPr><w:b/><w:rFonts w:ascii="Noto Sans"/><w:sz w:val="28"/><w:color w:val="FF0000"/></w:rPr><w:t>Alpha </w:t></w:r><w:r><w:rPr><w:i/><w:u w:val="single"/><w:highlight w:val="yellow"/></w:rPr><w:t>Beta</w:t></w:r></w:p></w:body></w:document>"#,
    )]);

    let model = docx_model(&bytes).expect("DOCX run model should parse");
    let block = &model["blocks"][0];

    assert_eq!(block["text"], "Alpha Beta");
    assert_eq!(block["runs"][0]["text"], "Alpha ");
    assert_eq!(block["runs"][0]["bold"], true);
    assert_eq!(block["runs"][0]["fontFamily"], "Noto Sans");
    assert_eq!(block["runs"][0]["fontSize"], "14");
    assert_eq!(block["runs"][0]["color"], "#FF0000");
    assert_eq!(block["runs"][1]["text"], "Beta");
    assert_eq!(block["runs"][1]["italic"], true);
    assert_eq!(block["runs"][1]["underline"], true);
    assert_eq!(block["runs"][1]["highlight"], "yellow");
}

#[test]
fn docx_model_reads_run_level_false_overrides() {
    let bytes = test_ooxml_package(&[(
        "word/document.xml",
        r#"<w:document><w:body><w:p><w:r><w:rPr><w:b w:val="false"/><w:i w:val="false"/><w:u w:val="none"/><w:strike w:val="false"/></w:rPr><w:t>Plain</w:t></w:r></w:p></w:body></w:document>"#,
    )]);

    let model = docx_model(&bytes).expect("DOCX false run overrides should parse");
    let block = &model["blocks"][0];

    assert_eq!(block["bold"], false);
    assert_eq!(block["italic"], false);
    assert_eq!(block["underline"], false);
    assert_eq!(block["strikethrough"], false);
    assert_eq!(block["runs"][0]["bold"], false);
    assert_eq!(block["runs"][0]["italic"], false);
    assert_eq!(block["runs"][0]["underline"], false);
    assert_eq!(block["runs"][0]["strikethrough"], false);
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
        r#"<w:document><w:body><w:p><w:r><w:t>Before</w:t></w:r></w:p><w:p><w:pPr><w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:pPr></w:p><w:p><w:r><w:t>After</w:t></w:r></w:p></w:body></w:document>"#,
    )]);

    let model = docx_model(&bytes).expect("DOCX section break model should parse");

    assert_eq!(model["blocks"][1]["type"], "sectionBreak");
    assert_eq!(model["blocks"][1]["breakKind"], "continuous");
    assert_eq!(model["blocks"][1]["sectionPage"]["width"], 12240);
    assert_eq!(model["blocks"][1]["sectionPage"]["marginLeft"], 1440);
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
    assert_eq!(block["hyperlinks"][0]["start"], 0);
    assert_eq!(block["hyperlinks"][0]["end"], 4);
    assert_eq!(block["hyperlinks"][0]["target"], "https://example.com/docs");
}

#[test]
fn docx_anchored_ranges_parse_and_round_trip_with_utf16_offsets() {
    let original = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>😀</w:t></w:r><w:commentRangeStart w:id="4"/><w:r><w:t>Intro</w:t></w:r><w:commentRangeEnd w:id="4"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="4"/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r><w:hyperlink r:id="rId5"><w:r><w:t>Link</w:t></w:r></w:hyperlink><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="2"/></w:r><w:r><w:t xml:space="preserve"> end</w:t></w:r></w:p></w:body></w:document>"#,
        ),
        (
            "word/_rels/document.xml.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>"#,
        ),
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
        ),
    ]);
    let mut model = docx_model(&original).expect("anchored DOCX model should parse");
    let block = &model["blocks"][0];

    assert_eq!(block["text"], "😀Intro Link end");
    assert_eq!(block["commentRanges"][0]["start"], 2);
    assert_eq!(block["commentRanges"][0]["end"], 7);
    assert_eq!(block["hyperlinks"][0]["start"], 8);
    assert_eq!(block["hyperlinks"][0]["end"], 12);
    assert_eq!(block["noteReferences"][0]["offset"], 12);

    model["blocks"][0]["text"] = json!("X😀Intro Link end");
    model["blocks"][0]["runs"] = json!([{ "text": "X😀Intro Link end" }]);
    model["blocks"][0]["commentId"] = Value::Null;
    model["blocks"][0]["relationshipId"] = Value::Null;
    model["blocks"][0]["target"] = Value::Null;
    model["blocks"][0]["footnoteId"] = Value::Null;
    model["blocks"][0]["commentRanges"][0]["start"] = json!(3);
    model["blocks"][0]["commentRanges"][0]["end"] = json!(8);
    model["blocks"][0]["hyperlinks"][0]["start"] = json!(9);
    model["blocks"][0]["hyperlinks"][0]["end"] = json!(13);
    model["blocks"][0]["noteReferences"][0]["offset"] = json!(13);

    let updated = update_docx(&original, &model).expect("anchored DOCX should save");
    let reopened = docx_model(&updated).expect("anchored DOCX should reopen");
    let reopened_block = &reopened["blocks"][0];
    assert_eq!(reopened_block["text"], "X😀Intro Link end");
    assert_eq!(reopened_block["commentRanges"][0]["start"], 3);
    assert_eq!(reopened_block["commentRanges"][0]["end"], 8);
    assert_eq!(reopened_block["hyperlinks"][0]["start"], 9);
    assert_eq!(reopened_block["hyperlinks"][0]["end"], 13);
    assert_eq!(
        reopened_block["hyperlinks"][0]["target"],
        "https://example.com"
    );
    assert_eq!(reopened_block["noteReferences"][0]["offset"], 13);
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
