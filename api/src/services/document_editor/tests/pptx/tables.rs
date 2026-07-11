use super::super::super::*;
use super::super::common::*;

#[test]
fn pptx_model_exposes_slide_tables() {
    let slide_xml = pptx_test_slide_with_table_xml("Title", &[&["A1", "B1"], &["A2", "B2"]]);
    let package = test_ooxml_package(&[("ppt/slides/slide1.xml", slide_xml.as_str())]);

    let model = pptx_model(&package).unwrap();

    assert_eq!(model["slides"][0]["texts"][0]["text"], "Title");
    assert_eq!(model["slides"][0]["texts"][0]["textIndex"], 0);
    assert_eq!(model["slides"][0]["tables"][0]["textIndexStart"], 1);
    assert_eq!(model["slides"][0]["tables"][0]["rows"][0][0], "A1");
    assert_eq!(model["slides"][0]["tables"][0]["rows"][1][1], "B2");
    assert!(
        (model["slides"][0]["tables"][0]["columnWidths"][0]
            .as_f64()
            .unwrap()
            - 33.333)
            .abs()
            < 0.01
    );
    assert!(
        (model["slides"][0]["tables"][0]["rowHeights"][1]
            .as_f64()
            .unwrap()
            - 66.666)
            .abs()
            < 0.01
    );
    assert_eq!(
        model["slides"][0]["tables"][0]["tableStyleId"],
        "{11111111-1111-1111-1111-111111111111}"
    );
    assert_eq!(model["slides"][0]["tables"][0]["firstRow"], true);
    assert_eq!(model["slides"][0]["tables"][0]["bandedRows"], true);
}

#[test]
fn pptx_model_exposes_table_style_catalog() {
    let slide_xml = pptx_test_slide_xml("Title");
    let table_styles_xml = r#"<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{22222222-2222-2222-2222-222222222222}"><a:tblStyle styleId="{22222222-2222-2222-2222-222222222222}" styleName="Blue table"><a:wholeTbl/></a:tblStyle></a:tblStyleLst>"#;
    let package = test_ooxml_package(&[
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
        ("ppt/tableStyles.xml", table_styles_xml),
    ]);

    let model = pptx_model(&package).unwrap();

    assert_eq!(
        model["tableStyles"][0]["id"],
        "{22222222-2222-2222-2222-222222222222}"
    );
    assert_eq!(model["tableStyles"][0]["name"], "Blue table");
    assert_eq!(model["tableStyles"][0]["default"], true);
}

#[test]
fn pptx_model_exposes_slide_table_cell_styles() {
    let slide_xml = r##"<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:graphicFrame><p:xfrm><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="1828800"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="1200"/></a:tblGrid><a:tr h="1000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr b="1" i="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Styled</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="1F2937"/></a:solidFill></a:tcPr></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>"##;
    let package = test_ooxml_package(&[("ppt/slides/slide1.xml", slide_xml)]);

    let model = pptx_model(&package).unwrap();
    let style = &model["slides"][0]["tables"][0]["cellStyles"][0][0];

    assert_eq!(style["fillColor"], "#1F2937");
    assert_eq!(style["textColor"], "#FFFFFF");
    assert_eq!(style["bold"], true);
    assert_eq!(style["italic"], true);
    assert_eq!(style["align"], "center");
}

#[test]
fn pptx_update_rewrites_slide_table_text_without_clearing_other_text() {
    let slide_xml = pptx_test_slide_with_table_xml("Title", &[&["A1", "B1"], &["A2", "B2"]]);
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["slides"][0]["texts"][0]["text"] = json!("New title");
    model["slides"][0]["tables"][0]["rows"] = json!([["Q1", "Revenue"], ["Q2", "Cost"]]);

    let updated = update_pptx(&package, &model).unwrap();
    let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

    assert!(slide.contains("<a:t>New title</a:t>"));
    assert!(slide.contains("<a:t>Q1</a:t>"));
    assert!(slide.contains("<a:t>Revenue</a:t>"));
    assert!(slide.contains("<a:t>Q2</a:t>"));
    assert!(slide.contains("<a:t>Cost</a:t>"));
    assert!(!slide.contains("<a:t>A1</a:t>"));
}

#[test]
fn pptx_update_inserts_new_slide_table_frame() {
    let slide_xml = pptx_test_slide_xml("Title");
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["slides"][0]["tables"] = json!([{
        "id": "tbl1",
        "x": 20.0,
        "y": 24.0,
        "width": 50.0,
        "height": 30.0,
        "rows": [["Name", "Value"], ["A", "12"]]
    }]);

    let updated = update_pptx(&package, &model).unwrap();
    let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

    assert!(slide.contains("<p:graphicFrame>"));
    assert!(slide.contains("<a:tbl>"));
    assert!(slide.contains("<a:t>Name</a:t>"));
    assert!(slide.contains("<a:t>12</a:t>"));
    assert!(slide.contains(r#"<a:off x="1828800" y="1234440"/>"#));
}

#[test]
fn pptx_update_writes_slide_table_dimensions() {
    let slide_xml = pptx_test_slide_with_table_xml("Title", &[&["A1", "B1"], &["A2", "B2"]]);
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["slides"][0]["tables"][0]["columnWidths"] = json!([25.0, 75.0]);
    model["slides"][0]["tables"][0]["rowHeights"] = json!([40.0, 60.0]);

    let updated = update_pptx(&package, &model).unwrap();
    let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

    assert!(slide.contains(r#"<a:gridCol w="914400"/><a:gridCol w="2743200"/>"#));
    assert!(slide.contains(r#"<a:tr h="731520">"#));
    assert!(slide.contains(r#"<a:tr h="1097280">"#));
}

#[test]
fn pptx_update_writes_slide_table_cell_styles() {
    let slide_xml = pptx_test_slide_with_table_xml("Title", &[&["A1", "B1"], &["A2", "B2"]]);
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["slides"][0]["tables"][0]["cellStyles"] = json!([
        [
            {
                "fillColor": "#1F2937",
                "textColor": "#FFFFFF",
                "bold": true,
                "italic": true,
                "align": "center"
            },
            {}
        ],
        [{}, {}]
    ]);

    let updated = update_pptx(&package, &model).unwrap();
    let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

    assert!(slide.contains(r#"<a:pPr algn="ctr"/>"#));
    assert!(slide.contains(
        r#"<a:rPr b="1" i="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr>"#
    ));
    assert!(
        slide.contains(r#"<a:tcPr><a:solidFill><a:srgbClr val="1F2937"/></a:solidFill></a:tcPr>"#)
    );
}

#[test]
fn pptx_update_writes_slide_table_style_flags() {
    let slide_xml = pptx_test_slide_with_table_xml("Title", &[&["A1", "B1"], &["A2", "B2"]]);
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["slides"][0]["tables"][0]["tableStyleId"] =
        json!("{22222222-2222-2222-2222-222222222222}");
    model["slides"][0]["tables"][0]["firstRow"] = json!(false);
    model["slides"][0]["tables"][0]["lastRow"] = json!(true);
    model["slides"][0]["tables"][0]["firstColumn"] = json!(true);
    model["slides"][0]["tables"][0]["bandedRows"] = json!(false);
    model["slides"][0]["tables"][0]["bandedColumns"] = json!(true);

    let updated = update_pptx(&package, &model).unwrap();
    let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

    assert!(
        slide.contains("<a:tableStyleId>{22222222-2222-2222-2222-222222222222}</a:tableStyleId>")
    );
    assert!(slide.contains(
        r#"<a:tblPr firstRow="0" firstCol="1" lastRow="1" lastCol="0" bandRow="0" bandCol="1">"#
    ));
}

#[test]
fn pptx_rich_or_merged_table_is_preserved_on_unrelated_save() {
    let slide_xml = pptx_test_slide_with_table_xml("Title", &[&["A1", "B1"]])
        .replacen(
            "<a:r><a:t>A1</a:t></a:r>",
            "<a:r><a:rPr b=\"1\"/><a:t>A</a:t></a:r><a:r><a:rPr i=\"1\"/><a:t>1</a:t></a:r>",
            1,
        )
        .replacen("<a:tc>", "<a:tc gridSpan=\"2\">", 1);
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
    ]);
    let model = pptx_model(&package).unwrap();
    assert_eq!(model["slides"][0]["tables"][0]["preservationOnly"], true);

    let updated = update_pptx(&package, &model).unwrap();
    let saved = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

    assert!(saved.contains(r#"<a:tc gridSpan="2">"#));
    assert!(saved
        .contains(r#"<a:r><a:rPr b="1"/><a:t>A</a:t></a:r><a:r><a:rPr i="1"/><a:t>1</a:t></a:r>"#));
}
