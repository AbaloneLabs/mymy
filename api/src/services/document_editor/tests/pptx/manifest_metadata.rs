use super::super::super::*;
use super::super::common::*;

#[test]
fn pptx_presentation_manifest_rewrites_order_and_adds_new_slide_relationship() {
    let presentation = r#"<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>"#;
    let rels = r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>"#;
    let slides = vec![
        PptxPresentationSlideWrite {
            path: "ppt/slides/slide2.xml".to_string(),
        },
        PptxPresentationSlideWrite {
            path: "ppt/slides/slide3.xml".to_string(),
        },
    ];

    let (presentation, rels) = update_pptx_presentation_manifest(presentation, rels, &slides);
    let content_types = append_pptx_slide_content_types_for_writes("<Types></Types>", &slides);

    assert!(!presentation.contains(r#"r:id="rId1""#));
    assert!(
        presentation.contains(r#"<p:sldId id="257" r:id="rId2"/><p:sldId id="258" r:id="rId3"/>"#)
    );
    assert!(rels.contains(r#"Target="slides/slide3.xml""#));
    assert!(content_types.contains(r#"PartName="/ppt/slides/slide3.xml""#));
}

#[test]
fn pptx_model_exposes_layout_and_theme_metadata() {
    let bytes = test_ooxml_package(&[
        (
            "ppt/slides/slide1.xml",
            r#"<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>"#,
        ),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rIdLayout" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>"#,
        ),
        (
            "ppt/slideLayouts/slideLayout1.xml",
            r#"<p:sldLayout type="title"><p:cSld name="Title Slide"><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="514350"/><a:ext cx="7315200" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="3200"><a:latin typeface="Aptos Display"/></a:rPr><a:t>Layout Title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>"#,
        ),
        (
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
            r#"<Relationships><Relationship Id="rIdMaster" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>"#,
        ),
        ("ppt/slideMasters/slideMaster1.xml", r#"<p:sldMaster/>"#),
        (
            "ppt/slideMasters/_rels/slideMaster1.xml.rels",
            r#"<Relationships><Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>"#,
        ),
        ("ppt/theme/theme1.xml", pptx_test_theme_xml()),
    ]);

    let model = pptx_model(&bytes).unwrap();

    assert_eq!(model["slides"][0]["layoutRelationshipId"], "rIdLayout");
    assert_eq!(
        model["slides"][0]["layoutPath"],
        "ppt/slideLayouts/slideLayout1.xml"
    );
    assert_eq!(model["slides"][0]["layoutName"], "Title Slide");
    assert_eq!(model["slides"][0]["layoutType"], "title");
    assert_eq!(model["slides"][0]["layoutThemeName"], "Mymy Theme");
    assert_eq!(model["layouts"][0]["themeName"], "Mymy Theme");
    assert_eq!(
        model["layouts"][0]["masterPath"],
        "ppt/slideMasters/slideMaster1.xml"
    );
    assert_eq!(model["layouts"][0]["masterName"], "slideMaster1.xml");
    assert_eq!(model["masters"][0]["name"], "Slide Master");
    assert_eq!(model["masters"][0]["themeName"], "Mymy Theme");
    assert_eq!(model["themes"][0]["name"], "Mymy Theme");
    assert_eq!(model["themes"][0]["colors"]["accent1"], "#4472C4");
    assert_eq!(model["themes"][0]["colors"]["dk1"], "#000000");
    assert_eq!(model["themes"][0]["majorFont"], "Aptos Display");
    assert_eq!(model["themes"][0]["minorFont"], "Aptos");
    assert_eq!(
        model["layouts"][0]["placeholderTexts"][0]["text"],
        "Layout Title"
    );
    assert_eq!(
        model["layouts"][0]["placeholderTexts"][0]["placeholderType"],
        "title"
    );
    assert_eq!(
        model["layouts"][0]["placeholderTexts"][0]["fontFamily"],
        "Aptos Display"
    );
}

#[test]
fn pptx_update_rewrites_master_placeholder_text_and_geometry() {
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        (
            "ppt/slides/slide1.xml",
            r#"<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>"#,
        ),
        (
            "ppt/slideMasters/slideMaster1.xml",
            r#"<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Old Master"><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="514350"/><a:ext cx="7315200" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Old title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sldMaster>"#,
        ),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["masters"][0]["name"] = json!("Edited Master");
    model["masters"][0]["placeholderTexts"][0]["text"] = json!("Edited master title");
    model["masters"][0]["placeholderTexts"][0]["y"] = json!(20.0);
    model["masters"][0]["placeholderTexts"][0]["height"] = json!(15.0);

    let updated = update_pptx(&package, &model).unwrap();
    let master = read_zip_text(&updated, "ppt/slideMasters/slideMaster1.xml").unwrap();

    assert!(master.contains(r#"name="Edited Master""#));
    assert!(master.contains("<a:t>Edited master title</a:t>"));
    assert!(master.contains(r#"y="1028700""#));
    assert!(master.contains(r#"cy="771525""#));
}

#[test]
fn pptx_model_uses_presentation_slide_size_for_geometry() {
    let package = test_ooxml_package(&[
        (
            "ppt/presentation.xml",
            r#"<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldSz cx="9144000" cy="6858000" type="screen4x3"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>"#,
        ),
        (
            "ppt/slides/slide1.xml",
            r#"<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="685800"/><a:ext cx="1828800" cy="1371600"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Four three</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>"#,
        ),
    ]);

    let model = pptx_model(&package).unwrap();
    let text = &model["slides"][0]["texts"][0];

    assert_eq!(model["slideWidthEmu"], 9_144_000.0);
    assert_eq!(model["slideHeightEmu"], 6_858_000.0);
    assert_eq!(model["slideSizeType"], "screen4x3");
    assert!((text["y"].as_f64().unwrap() - 10.0).abs() < 0.01);
    assert!((text["height"].as_f64().unwrap() - 20.0).abs() < 0.01);
}

#[test]
fn pptx_update_preserves_slide_size_and_writes_geometry_against_it() {
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        (
            "ppt/presentation.xml",
            r#"<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldSz cx="9144000" cy="6858000" type="screen4x3"/><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>"#,
        ),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        (
            "ppt/slides/slide1.xml",
            r#"<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="685800"/><a:ext cx="1828800" cy="1371600"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Four three</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>"#,
        ),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["slides"][0]["texts"][0]["y"] = json!(15.0);
    model["slides"][0]["texts"][0]["height"] = json!(25.0);

    let updated = update_pptx(&package, &model).unwrap();
    let presentation = read_zip_text(&updated, "ppt/presentation.xml").unwrap();
    let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

    assert!(presentation.contains(r#"<p:sldSz cx="9144000" cy="6858000" type="screen4x3"/>"#));
    assert!(slide.contains(r#"y="1028700""#));
    assert!(slide.contains(r#"cy="1714500""#));
}

#[test]
fn pptx_slide_layout_relationship_upsert_preserves_existing_id() {
    let rels = r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>"#;

    let updated = upsert_pptx_slide_layout_relationship(rels, "ppt/slideLayouts/slideLayout2.xml");

    assert!(updated.contains(r#"Id="rId1""#));
    assert!(updated.contains(r#"Target="../slideLayouts/slideLayout2.xml""#));
    assert!(!updated.contains("slideLayout1.xml"));
}

#[test]
fn pptx_update_rewrites_theme_name_colors_and_fonts() {
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        (
            "ppt/slides/slide1.xml",
            r#"<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>"#,
        ),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rIdLayout" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>"#,
        ),
        (
            "ppt/slideLayouts/slideLayout1.xml",
            r#"<p:sldLayout type="title"><p:cSld name="Title Slide"/></p:sldLayout>"#,
        ),
        (
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
            r#"<Relationships><Relationship Id="rIdMaster" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>"#,
        ),
        ("ppt/slideMasters/slideMaster1.xml", r#"<p:sldMaster/>"#),
        (
            "ppt/slideMasters/_rels/slideMaster1.xml.rels",
            r#"<Relationships><Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>"#,
        ),
        ("ppt/theme/theme1.xml", pptx_test_theme_xml()),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["themes"][0]["name"] = json!("Edited Theme");
    model["themes"][0]["colors"]["accent1"] = json!("#112233");
    model["themes"][0]["colors"]["dk1"] = json!("#010203");
    model["themes"][0]["majorFont"] = json!("Noto Sans");
    model["themes"][0]["minorFont"] = json!("Noto Serif");

    let updated = update_pptx(&package, &model).unwrap();
    let theme = read_zip_text(&updated, "ppt/theme/theme1.xml").unwrap();

    assert!(theme.contains(r#"name="Edited Theme""#));
    assert!(theme.contains(r#"<a:dk1><a:srgbClr val="010203"/></a:dk1>"#));
    assert!(theme.contains(r#"<a:accent1><a:srgbClr val="112233"/></a:accent1>"#));
    assert!(theme.contains(r#"<a:majorFont><a:latin typeface="Noto Sans"/>"#));
    assert!(theme.contains(r#"<a:minorFont><a:latin typeface="Noto Serif"/>"#));
}
