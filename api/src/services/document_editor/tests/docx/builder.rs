use super::super::super::*;

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
        "keepWithNext": true,
        "keepLinesTogether": true,
    });

    let xml = build_docx_paragraph(&block);

    assert!(xml.contains(r#"<w:pStyle w:val="Heading3"/>"#));
    assert!(xml.contains(r#"<w:jc w:val="justify"/>"#));
    assert!(xml.contains(r#"<w:ind w:left="720"/>"#));
    assert!(
        xml.contains(r#"<w:spacing w:before="120" w:after="240" w:line="360" w:lineRule="auto"/>"#)
    );
    assert!(xml.contains("<w:pageBreakBefore/>"));
    assert!(xml.contains("<w:keepNext/>"));
    assert!(xml.contains("<w:keepLines/>"));
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
fn docx_paragraph_builder_writes_run_level_formatting() {
    let xml = build_docx_paragraph(&json!({
        "type": "paragraph",
        "text": "Alpha Beta",
        "runs": [
            {
                "text": "Alpha ",
                "bold": true,
                "fontFamily": "Noto Sans",
                "fontSize": "14",
                "color": "#FF0000"
            },
            {
                "text": "Beta",
                "italic": true,
                "underline": true,
                "highlight": "yellow"
            }
        ]
    }));

    assert!(xml.contains(r#"<w:t xml:space="preserve">Alpha </w:t>"#));
    assert!(xml.contains(r#"<w:t xml:space="preserve">Beta</w:t>"#));
    assert!(xml.contains("<w:b/>"));
    assert!(xml.contains(r#"<w:rFonts w:ascii="Noto Sans""#));
    assert!(xml.contains(r#"<w:sz w:val="28"/>"#));
    assert!(xml.contains(r#"<w:color w:val="FF0000"/>"#));
    assert!(xml.contains("<w:i/>"));
    assert!(xml.contains(r#"<w:u w:val="single"/>"#));
    assert!(xml.contains(r#"<w:highlight w:val="yellow"/>"#));
}

#[test]
fn docx_paragraph_builder_ignores_stale_run_ranges() {
    let xml = build_docx_paragraph(&json!({
        "type": "paragraph",
        "text": "Full text",
        "runs": [
            { "text": "Old", "bold": true }
        ]
    }));

    assert!(xml.contains(r#"<w:t xml:space="preserve">Full text</w:t>"#));
    assert!(!xml.contains(r#"<w:t xml:space="preserve">Old</w:t>"#));
    assert!(!xml.contains("<w:b/>"));
}

#[test]
fn docx_paragraph_builder_writes_run_level_false_overrides() {
    let xml = build_docx_paragraph(&json!({
        "type": "paragraph",
        "text": "Plain",
        "runs": [
            {
                "text": "Plain",
                "bold": false,
                "italic": false,
                "underline": false,
                "strikethrough": false
            }
        ]
    }));

    assert!(xml.contains(r#"<w:b w:val="false"/>"#));
    assert!(xml.contains(r#"<w:i w:val="false"/>"#));
    assert!(xml.contains(r#"<w:u w:val="none"/>"#));
    assert!(xml.contains(r#"<w:strike w:val="false"/>"#));
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
fn docx_paragraph_builder_writes_utf16_anchored_inline_features() {
    let xml = build_docx_paragraph(&json!({
        "id": "p1",
        "type": "paragraph",
        "text": "😀Alpha Beta",
        "runs": [
            { "text": "😀Alpha ", "bold": true },
            { "text": "Beta", "italic": true }
        ],
        "commentRanges": [
            { "commentId": "4", "start": 2, "end": 7 }
        ],
        "hyperlinks": [
            {
                "id": "p1-link-1",
                "start": 8,
                "end": 12,
                "target": "https://example.com",
                "relationshipId": "rId8"
            }
        ],
        "noteReferences": [
            { "id": "2", "kind": "footnote", "offset": 7 }
        ]
    }));

    assert!(xml.contains("<w:t xml:space=\"preserve\">😀</w:t>"));
    assert!(xml.contains(
        r#"<w:commentRangeStart w:id="4"/><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Alpha</w:t></w:r><w:commentRangeEnd w:id="4"/>"#
    ));
    assert!(xml.contains(r#"<w:footnoteReference w:id="2"/>"#));
    assert!(xml.contains(
        r#"<w:hyperlink r:id="rId8"><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">Beta</w:t></w:r></w:hyperlink>"#
    ));
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
