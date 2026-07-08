use super::super::*;
use super::common::*;

#[test]
fn editor_kind_excludes_html_for_dedicated_web_viewer() {
    assert_eq!(
        editor_kind_for_path(Path::new("index.html")),
        DocumentEditorKind::Preview
    );
    assert_eq!(
        editor_kind_for_path(Path::new("page.htm")),
        DocumentEditorKind::Preview
    );
}

#[test]
fn editor_kind_accepts_document_and_structured_text_formats() {
    assert_eq!(
        editor_kind_for_path(Path::new("notes.md")),
        DocumentEditorKind::Markdown
    );
    assert_eq!(
        editor_kind_for_path(Path::new("data.json")),
        DocumentEditorKind::Text
    );
    assert_eq!(
        editor_kind_for_path(Path::new("sheet.csv")),
        DocumentEditorKind::Csv
    );
    assert_eq!(
        editor_kind_for_path(Path::new("book.xlsx")),
        DocumentEditorKind::Xlsx
    );
    assert_eq!(
        editor_kind_for_path(Path::new("deck.pptx")),
        DocumentEditorKind::Pptx
    );
}

#[test]
fn text_model_preserves_utf8_bom_and_line_ending_metadata() {
    let model = text_model(b"\xEF\xBB\xBFalpha\r\nbeta\r\n").expect("text model should parse");

    assert_eq!(model["content"], "alpha\nbeta\n");
    assert_eq!(model["encoding"], "utf-8");
    assert_eq!(model["bom"], true);
    assert_eq!(model["lineEnding"], "\r\n");
    assert_eq!(model["trailingNewline"], true);
}

#[test]
fn text_serializer_restores_selected_line_ending_and_bom() {
    let model = json!({
        "content": "alpha\nbeta\n",
        "bom": true,
        "lineEnding": "\r\n",
    });

    let bytes = text_bytes(&[], &model).expect("text should serialize");

    assert_eq!(bytes, b"\xEF\xBB\xBFalpha\r\nbeta\r\n");
}

#[test]
fn text_serializer_falls_back_to_original_metadata() {
    let model = json!({
        "content": "alpha\nbeta",
    });

    let bytes = text_bytes(b"\xEF\xBB\xBFold\rsecond", &model)
        .expect("text should serialize with original metadata");

    assert_eq!(bytes, b"\xEF\xBB\xBFalpha\rbeta");
}

#[test]
fn structured_text_validation_accepts_valid_json_yaml_and_toml() {
    validate_structured_text_for_path(Path::new("config.json"), br#"{"name":"mymy"}"#)
        .expect("valid JSON should pass");
    validate_structured_text_for_path(Path::new("config.yaml"), b"name: mymy\nitems:\n  - one\n")
        .expect("valid YAML should pass");
    validate_structured_text_for_path(Path::new("config.toml"), b"name = \"mymy\"\n")
        .expect("valid TOML should pass");
}

#[test]
fn structured_text_validation_rejects_invalid_json_yaml_and_toml() {
    assert!(validate_structured_text_for_path(Path::new("config.json"), b"{").is_err());
    assert!(validate_structured_text_for_path(Path::new("config.yaml"), b"name: [").is_err());
    assert!(validate_structured_text_for_path(Path::new("config.toml"), b"name =").is_err());
}

#[test]
fn ooxml_validation_accepts_required_parts_and_relationship_targets() {
    let bytes = test_ooxml_package(&[
        ("[Content_Types].xml", "<Types/>"),
        (
            "_rels/.rels",
            r#"<Relationships><Relationship Id="rId1" Target="word/document.xml"/></Relationships>"#,
        ),
        ("word/document.xml", "<w:document/>"),
        (
            "word/_rels/document.xml.rels",
            r#"<Relationships><Relationship Id="rId2" Target="media/image1.png"/></Relationships>"#,
        ),
        ("word/media/image1.png", "image"),
    ]);

    validate_ooxml_package(DocumentEditorKind::Docx, &bytes)
        .expect("valid DOCX package should pass");
}

#[test]
fn ooxml_validation_rejects_missing_required_part() {
    let bytes = test_ooxml_package(&[
        ("[Content_Types].xml", "<Types/>"),
        ("_rels/.rels", "<Relationships/>"),
        ("word/document.xml", "<w:document/>"),
    ]);

    assert!(validate_ooxml_package(DocumentEditorKind::Docx, &bytes).is_err());
}

#[test]
fn ooxml_validation_rejects_missing_internal_relationship_target() {
    let bytes = test_ooxml_package(&[
        ("[Content_Types].xml", "<Types/>"),
        (
            "_rels/.rels",
            r#"<Relationships><Relationship Id="rId1" Target="word/document.xml"/></Relationships>"#,
        ),
        ("word/document.xml", "<w:document/>"),
        (
            "word/_rels/document.xml.rels",
            r#"<Relationships><Relationship Id="rId2" Target="media/missing.png"/></Relationships>"#,
        ),
    ]);

    assert!(validate_ooxml_package(DocumentEditorKind::Docx, &bytes).is_err());
}

#[test]
fn docx_compatibility_warnings_detect_preserved_uneditable_parts() {
    let bytes = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:sdt/><w:fldSimple/><w:moveFrom/><w:r><w:drawing/><m:oMath/></w:r></w:p><w:sectPr/></w:body></w:document>"#,
        ),
        ("word/header1.xml", "<w:hdr/>"),
        ("word/styles.xml", "<w:styles/>"),
        ("word/theme/theme1.xml", "<a:theme/>"),
        ("word/fontTable.xml", "<w:fonts/>"),
        ("word/charts/chart1.xml", "<c:chartSpace/>"),
        ("customXml/item1.xml", "<root/>"),
        ("word/vbaProject.bin", "macro"),
    ]);

    let warnings = compatibility_warnings_for_bytes(DocumentEditorKind::Docx, &bytes);
    let codes = warning_codes(&warnings);

    assert!(codes.contains(&"docx-drawing"));
    assert!(codes.contains(&"docx-header-footer"));
    assert!(codes.contains(&"docx-section"));
    assert!(codes.contains(&"docx-content-controls"));
    assert!(codes.contains(&"docx-fields"));
    assert!(codes.contains(&"docx-move-tracking"));
    assert!(codes.contains(&"docx-equations"));
    assert!(codes.contains(&"docx-charts"));
    assert!(codes.contains(&"docx-styles-fonts"));
    assert!(codes.contains(&"docx-custom-xml"));
    assert!(codes.contains(&"docx-macros"));
    assert!(warnings
        .iter()
        .any(|warning| warning.severity == DocumentCompatibilityWarningSeverity::Danger));
}

#[test]
fn xlsx_compatibility_warnings_detect_formulas_and_macros() {
    let bytes = test_ooxml_package(&[
        (
            "xl/worksheets/sheet1.xml",
            r#"<worksheet><sheetData><row r="1"><c r="A1"><f t="array" ref="A1:B2">B1:C2</f><v>3</v></c></row></sheetData></worksheet>"#,
        ),
        ("xl/styles.xml", "<styleSheet/>"),
        ("xl/tables/table1.xml", "<table/>"),
        ("xl/drawings/drawing1.xml", "<xdr:wsDr/>"),
        ("xl/externalLinks/externalLink1.xml", "<externalLink/>"),
        ("xl/vbaProject.bin", "macro"),
    ]);

    let warnings = compatibility_warnings_for_bytes(DocumentEditorKind::Xlsx, &bytes);
    let codes = warning_codes(&warnings);

    assert!(codes.contains(&"xlsx-formulas"));
    assert!(codes.contains(&"xlsx-array-formulas"));
    assert!(codes.contains(&"xlsx-styles"));
    assert!(codes.contains(&"xlsx-tables"));
    assert!(codes.contains(&"xlsx-drawings"));
    assert!(codes.contains(&"xlsx-external-links"));
    assert!(codes.contains(&"xlsx-macros"));
    assert!(warnings
        .iter()
        .any(|warning| warning.code == "xlsx-external-links"
            && warning.severity == DocumentCompatibilityWarningSeverity::Warning));
    assert!(warnings
        .iter()
        .any(|warning| warning.severity == DocumentCompatibilityWarningSeverity::Danger));
}

#[test]
fn pptx_compatibility_warnings_detect_media_and_motion() {
    let bytes = test_ooxml_package(&[
        (
            "ppt/presentation.xml",
            r#"<p:presentation><p:sldSz cx="12192000" cy="6858000" type="wide"/></p:presentation>"#,
        ),
        (
            "ppt/slides/slide1.xml",
            r#"<p:sld><p:cSld><p:spTree><p:pic/><p:sp><p:txBody><a:p><a:r><a:t>Hi</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:transition/><p:timing/></p:sld>"#,
        ),
        ("ppt/media/image1.png", "image"),
        ("ppt/slideMasters/slideMaster1.xml", "<p:sldMaster/>"),
        ("ppt/slideLayouts/slideLayout1.xml", "<p:sldLayout/>"),
        ("ppt/theme/theme1.xml", "<a:theme/>"),
        ("ppt/vbaProject.bin", "macro"),
    ]);

    let warnings = compatibility_warnings_for_bytes(DocumentEditorKind::Pptx, &bytes);
    let codes = warning_codes(&warnings);

    assert!(codes.contains(&"pptx-media"));
    assert!(codes.contains(&"pptx-slide-masters"));
    assert!(codes.contains(&"pptx-slide-layouts"));
    assert!(codes.contains(&"pptx-themes"));
    assert!(codes.contains(&"pptx-slide-size"));
    assert!(codes.contains(&"pptx-transitions"));
    assert!(codes.contains(&"pptx-animations"));
    assert!(codes.contains(&"pptx-macros"));
    assert!(warnings
        .iter()
        .any(|warning| warning.severity == DocumentCompatibilityWarningSeverity::Danger));
}

#[test]
fn csv_parser_handles_quotes_commas_and_newlines() {
    let rows = parse_delimited("name,note\nalpha,\"one, two\"\nbeta,\"line\nbreak\"", ',');

    assert_eq!(
        rows,
        vec![
            vec!["name".to_string(), "note".to_string()],
            vec!["alpha".to_string(), "one, two".to_string()],
            vec!["beta".to_string(), "line\nbreak".to_string()],
        ]
    );
}

#[test]
fn delimited_serializer_quotes_when_needed() {
    let model = json!({
        "rows": [
            ["name", "note"],
            ["alpha", "one, two"],
            ["beta", "quote \"inside\""]
        ]
    });

    let bytes = delimited_bytes(&[], &model, ',').expect("CSV should serialize");
    assert_eq!(
        String::from_utf8(bytes).expect("CSV is UTF-8"),
        "name,note\nalpha,\"one, two\"\nbeta,\"quote \"\"inside\"\"\""
    );
}

#[test]
fn delimited_model_strips_and_records_utf8_bom() {
    let model =
        delimited_model(b"\xEF\xBB\xBFname,note\r\nalpha,one\r\n", ',').expect("CSV should parse");

    assert_eq!(model["rows"][0][0], "name");
    assert_eq!(model["encoding"], "utf-8");
    assert_eq!(model["bom"], true);
    assert_eq!(model["delimiter"], ",");
    assert_eq!(model["quoteCharacter"], "\"");
    assert_eq!(model["escapePolicy"], "double");
    assert_eq!(model["headerRow"], true);
    assert_eq!(model["columnTypes"][0], "text");
    assert_eq!(model["quoteStyle"], "minimal");
    assert_eq!(model["lineEnding"], "\r\n");
    assert_eq!(model["trailingNewline"], true);
}

#[test]
fn delimited_model_detects_semicolon_delimiter_and_column_types() {
    let model = delimited_model(b"name;amount;active\nalpha;12.5;true\nbeta;9;false\n", ',')
        .expect("semicolon CSV should parse");

    assert_eq!(model["delimiter"], ";");
    assert_eq!(model["rows"][1][1], "12.5");
    assert_eq!(model["headerRow"], true);
    assert_eq!(model["columnTypes"][0], "text");
    assert_eq!(model["columnTypes"][1], "number");
    assert_eq!(model["columnTypes"][2], "boolean");
}

#[test]
fn delimited_model_detects_single_quote_and_backslash_escape() {
    let model = delimited_model(b"'name','note'\n'alpha','one\\'two'\n", ',')
        .expect("single quoted CSV should parse");

    assert_eq!(model["quoteCharacter"], "'");
    assert_eq!(model["escapePolicy"], "backslash");
    assert_eq!(model["rows"][1][1], "one'two");
}

#[test]
fn delimited_model_detects_always_quoted_csv() {
    let model =
        delimited_model(b"\"name\",\"note\"\n\"alpha\",\"one\"\n", ',').expect("CSV should parse");

    assert_eq!(model["quoteStyle"], "always");
}

#[test]
fn delimited_serializer_preserves_original_always_quote_style_when_model_omits_it() {
    let model = json!({
        "rows": [
            ["name", "note"],
            ["alpha", "one"]
        ],
        "trailingNewline": true,
    });

    let bytes = delimited_bytes(b"\"old\",\"note\"\n", &model, ',').expect("CSV should serialize");

    assert_eq!(
        String::from_utf8(bytes).expect("CSV is UTF-8"),
        "\"name\",\"note\"\n\"alpha\",\"one\"\n"
    );
}

#[test]
fn delimited_serializer_uses_explicit_always_quote_style() {
    let model = json!({
        "rows": [
            ["name", "note"],
            ["alpha", "one"]
        ],
        "quoteStyle": "always",
    });

    let bytes = delimited_bytes(&[], &model, ',').expect("CSV should serialize");

    assert_eq!(
        String::from_utf8(bytes).expect("CSV is UTF-8"),
        "\"name\",\"note\"\n\"alpha\",\"one\""
    );
}

#[test]
fn delimited_serializer_uses_model_dialect_and_encoding() {
    let model = json!({
        "rows": [
            ["name", "note"],
            ["alpha", "one;two"]
        ],
        "delimiter": ";",
        "quoteCharacter": "'",
        "escapePolicy": "backslash",
        "quoteStyle": "minimal",
        "encoding": "windows-1252",
        "lineEnding": "\r\n",
        "trailingNewline": true,
    });

    let bytes = delimited_bytes(&[], &model, ',').expect("CSV should serialize");

    assert_eq!(
        String::from_utf8(bytes).expect("CSV bytes are ASCII-compatible"),
        "name;note\r\nalpha;'one;two'\r\n"
    );
}

#[test]
fn delimited_serializer_preserves_utf16le_encoding() {
    let original = [0xFF, 0xFE, b'a', 0, b',', 0, b'b', 0, b'\n', 0];
    let model = json!({
        "rows": [["x", "y"]],
        "lineEnding": "\n",
    });

    let bytes = delimited_bytes(&original, &model, ',').expect("UTF-16LE CSV should serialize");

    assert_eq!(bytes, [0xFF, 0xFE, b'x', 0, b',', 0, b'y', 0]);
}

#[test]
fn delimited_serializer_restores_original_bom_when_model_omits_it() {
    let model = json!({
        "rows": [
            ["name", "note"],
            ["alpha", "one"]
        ],
        "lineEnding": "\r\n",
        "trailingNewline": true,
    });

    let bytes =
        delimited_bytes(b"\xEF\xBB\xBFold,note\r\n", &model, ',').expect("CSV should serialize");

    assert_eq!(bytes, b"\xEF\xBB\xBFname,note\r\nalpha,one\r\n");
}

#[test]
fn delimited_serializer_preserves_crlf_and_trailing_newline() {
    let model = json!({
        "rows": [
            ["name", "note"],
            ["alpha", "one"],
        ],
        "lineEnding": "\r\n",
        "trailingNewline": true,
    });

    let bytes = delimited_bytes(&[], &model, ',').expect("CSV should serialize");
    assert_eq!(
        String::from_utf8(bytes).expect("CSV is UTF-8"),
        "name,note\r\nalpha,one\r\n"
    );
}

#[test]
fn tsv_parser_uses_tab_delimiter() {
    let rows = parse_delimited("a\tb\nc\td", '\t');

    assert_eq!(
        rows,
        vec![
            vec!["a".to_string(), "b".to_string()],
            vec!["c".to_string(), "d".to_string()],
        ]
    );
}
