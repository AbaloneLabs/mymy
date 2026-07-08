use super::super::*;
use super::common::*;

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

#[test]
fn pptx_text_shape_writes_basic_run_formatting() {
    let spec = PptxTextSpec {
        text: "Formatted slide text".to_string(),
        text_index: None,
        group_id: None,
        x: 10.0,
        y: 12.0,
        width: 40.0,
        height: 12.0,
        rotation: 15.0,
        font_size: 24,
        font_family: Some("Noto Sans".to_string()),
        color: Some("112233".to_string()),
        fill_color: Some("F8FAFC".to_string()),
        bold: true,
        italic: true,
        underline: true,
        strikethrough: true,
        align: Some("ctr".to_string()),
    };

    let xml = build_pptx_text_shape(7, &spec);

    assert!(
        xml.contains(r#"<a:rPr lang="en-US" sz="2400" b="1" i="1" u="sng" strike="sngStrike">"#)
    );
    assert!(xml.contains(r#"<a:pPr algn="ctr"/>"#));
    assert!(xml.contains(r#"<a:xfrm rot="900000">"#));
    assert!(xml.contains(r#"<a:latin typeface="Noto Sans"/>"#));
    assert!(xml.contains(r#"<a:srgbClr val="112233"/>"#));
    assert!(xml.contains(r#"<a:srgbClr val="F8FAFC"/>"#));
    assert!(xml.contains("<a:t>Formatted slide text</a:t>"));
}

#[test]
fn pptx_shape_model_reads_and_updates_geometry() {
    let xml = r#"<p:sld><p:sp><p:spPr><a:xfrm rot="1800000"><a:off x="914400" y="514350"/><a:ext cx="1828800" cy="1028700"/></a:xfrm></p:spPr><p:txBody><a:p><a:pPr algn="r"/><a:r><a:rPr u="sng" strike="sngStrike"/><a:t>Box</a:t></a:r></a:p></p:txBody></p:sp></p:sld>"#;
    let texts = pptx_shape_texts(xml);
    assert_eq!(texts[0]["text"], "Box");
    assert_eq!(texts[0]["x"], 10.0);
    assert_eq!(texts[0]["y"], 10.0);
    assert_eq!(texts[0]["width"], 20.0);
    assert_eq!(texts[0]["height"], 20.0);
    assert_eq!(texts[0]["rotation"], 30.0);
    assert_eq!(texts[0]["underline"], true);
    assert_eq!(texts[0]["strikethrough"], true);
    assert_eq!(texts[0]["align"], "right");

    let spec = PptxTextSpec {
        text: "Box".to_string(),
        text_index: None,
        group_id: None,
        x: 20.0,
        y: 30.0,
        width: 40.0,
        height: 50.0,
        rotation: 45.0,
        font_size: 18,
        font_family: None,
        color: None,
        fill_color: None,
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        align: None,
    };
    let updated = update_pptx_shape_geometries(xml, &[spec]);

    assert!(updated.contains(r#"<a:off x="1828800" y="1543050"/>"#));
    assert!(updated.contains(r#"<a:ext cx="3657600" cy="2571750"/>"#));
    assert!(updated.contains(r#"<a:xfrm rot="2700000">"#));
}

#[test]
fn pptx_basic_shape_model_reads_fill_stroke_and_geometry() {
    let xml = r##"<p:sld><p:sp><p:spPr><a:xfrm rot="900000"><a:off x="914400" y="514350"/><a:ext cx="1828800" cy="1028700"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="DBEAFE"/></a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill></a:ln></p:spPr></p:sp><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="1"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:srgbClr val="111827"/></a:solidFill><a:tailEnd type="diamond"/><a:headEnd type="triangle"/></a:ln></p:spPr></p:sp></p:sld>"##;

    let shapes = pptx_slide_shapes(xml);

    assert_eq!(shapes.len(), 2);
    assert_eq!(shapes[0]["kind"], "ellipse");
    assert_eq!(shapes[0]["x"], 10.0);
    assert_eq!(shapes[0]["y"], 10.0);
    assert_eq!(shapes[0]["width"], 20.0);
    assert_eq!(shapes[0]["height"], 20.0);
    assert_eq!(shapes[0]["rotation"], 15.0);
    assert_eq!(shapes[0]["fillColor"], "#DBEAFE");
    assert_eq!(shapes[0]["strokeColor"], "#2563EB");
    assert_eq!(shapes[0]["strokeWidth"], 2.0);
    assert_eq!(shapes[1]["kind"], "line");
    assert_eq!(shapes[1]["fillColor"], Value::Null);
    assert_eq!(shapes[1]["strokeColor"], "#111827");
    assert_eq!(shapes[1]["strokeWidth"], 1.0);
    assert_eq!(shapes[1]["lineStartArrow"], "diamond");
    assert_eq!(shapes[1]["lineEndArrow"], "triangle");
}

#[test]
fn pptx_basic_shape_model_reads_extended_shapes_and_connectors() {
    let xml = r##"<p:sld><p:sp><p:spPr><a:xfrm><a:off x="914400" y="514350"/><a:ext cx="1828800" cy="1028700"/></a:xfrm><a:prstGeom prst="pentagon"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="DBEAFE"/></a:solidFill></p:spPr></p:sp><p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="Connector"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="1"/></a:xfrm><a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:srgbClr val="111827"/></a:solidFill><a:headEnd type="triangle"/></a:ln></p:spPr></p:cxnSp></p:sld>"##;

    let shapes = pptx_slide_shapes(xml);

    assert_eq!(shapes.len(), 2);
    assert_eq!(shapes[0]["kind"], "pentagon");
    assert_eq!(shapes[1]["kind"], "straightConnector1");
    assert_eq!(shapes[1]["lineEndArrow"], "triangle");
}

#[test]
fn pptx_basic_shape_writes_geometry_fill_and_stroke() {
    let spec = PptxShapeSpec {
        kind: PptxShapeKind::Rect,
        group_id: None,
        x: 10.0,
        y: 20.0,
        width: 30.0,
        height: 40.0,
        rotation: 30.0,
        fill_color: Some("DBEAFE".to_string()),
        stroke_color: Some("2563EB".to_string()),
        stroke_width: 2.0,
        line_start_arrow: None,
        line_end_arrow: None,
    };

    let xml = build_pptx_basic_shape(9, &spec);

    assert!(xml.contains(r#"<p:cNvPr id="9" name="Shape 9"/>"#));
    assert!(xml.contains(r#"<a:xfrm rot="1800000">"#));
    assert!(xml.contains(r#"<a:off x="914400" y="1028700"/>"#));
    assert!(xml.contains(r#"<a:ext cx="2743200" cy="2057400"/>"#));
    assert!(xml.contains(r#"<a:prstGeom prst="rect">"#));
    assert!(xml.contains(r#"<a:srgbClr val="DBEAFE"/>"#));
    assert!(xml.contains(r#"<a:ln w="25400">"#));
    assert!(xml.contains(r#"<a:srgbClr val="2563EB"/>"#));
}

#[test]
fn pptx_connector_shape_writes_connector_xml() {
    let spec = PptxShapeSpec {
        kind: PptxShapeKind::StraightConnector1,
        group_id: None,
        x: 10.0,
        y: 20.0,
        width: 30.0,
        height: 0.0,
        rotation: 0.0,
        fill_color: None,
        stroke_color: Some("2563EB".to_string()),
        stroke_width: 2.0,
        line_start_arrow: None,
        line_end_arrow: Some(PptxLineArrowKind::Triangle),
    };

    let xml = build_pptx_basic_shape(9, &spec);

    assert!(xml.contains("<p:cxnSp>"));
    assert!(xml.contains("<p:cNvCxnSpPr/>"));
    assert!(xml.contains(r#"<a:prstGeom prst="straightConnector1">"#));
    assert!(xml.contains(r#"<a:headEnd type="triangle"/>"#));
}

#[test]
fn pptx_group_shape_model_reads_group_ids() {
    let xml = r##"<p:sld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr/><p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="Group group7"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="914400" y="514350"/><a:ext cx="3657600" cy="1543050"/><a:chOff x="914400" y="514350"/><a:chExt cx="3657600" cy="1543050"/></a:xfrm></p:grpSpPr><p:sp><p:spPr><a:xfrm><a:off x="914400" y="514350"/><a:ext cx="1828800" cy="514350"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:p><a:r><a:t>Grouped text</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:spPr><a:xfrm><a:off x="2743200" y="1028700"/><a:ext cx="1828800" cy="1028700"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="DBEAFE"/></a:solidFill></p:spPr></p:sp></p:grpSp></p:spTree></p:sld>"##;

    let texts = pptx_shape_texts(xml);
    let shapes = pptx_slide_shapes(xml);

    assert_eq!(texts[0]["groupId"], "group7");
    assert_eq!(shapes[0]["groupId"], "group7");
    assert_eq!(shapes[0]["kind"], "ellipse");
}

#[test]
fn pptx_grouped_objects_render_as_group_shape() {
    let text = PptxTextSpec {
        text: "Grouped".to_string(),
        text_index: None,
        group_id: Some("group1".to_string()),
        x: 10.0,
        y: 10.0,
        width: 30.0,
        height: 10.0,
        rotation: 0.0,
        font_size: 18,
        font_family: None,
        color: None,
        fill_color: None,
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        align: None,
    };
    let shape = PptxShapeSpec {
        kind: PptxShapeKind::Ellipse,
        group_id: Some("group1".to_string()),
        x: 45.0,
        y: 20.0,
        width: 20.0,
        height: 20.0,
        rotation: 0.0,
        fill_color: Some("DBEAFE".to_string()),
        stroke_color: Some("2563EB".to_string()),
        stroke_width: 2.0,
        line_start_arrow: None,
        line_end_arrow: None,
    };

    let xml = build_pptx_slide(&[text], &[shape], &[], &[], &[], None);

    assert!(xml.contains("<p:grpSp>"));
    assert!(xml.contains(r#"name="Group group1""#));
    assert!(xml.contains("<p:cNvGrpSpPr/>"));
    assert!(xml.contains("<a:chOff"));
    assert!(xml.contains("<a:chExt"));
    assert!(xml.contains("<a:t>Grouped</a:t>"));
    assert!(xml.contains(r#"<a:prstGeom prst="ellipse">"#));
}

#[test]
fn pptx_regroup_slide_objects_wraps_existing_managed_objects() {
    let xml = r#"<p:sld><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr></p:grpSpPr><p:sp><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:p><a:r><a:t>Old</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp><p:sp><p:spPr><a:prstGeom prst="flowChartProcess"><a:avLst/></a:prstGeom></p:spPr></p:sp></p:spTree></p:cSld></p:sld>"#;
    let text = PptxTextSpec {
        text: "New".to_string(),
        text_index: None,
        group_id: Some("group2".to_string()),
        x: 10.0,
        y: 10.0,
        width: 30.0,
        height: 10.0,
        rotation: 0.0,
        font_size: 18,
        font_family: None,
        color: None,
        fill_color: None,
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        align: None,
    };
    let shape = PptxShapeSpec {
        kind: PptxShapeKind::Rect,
        group_id: Some("group2".to_string()),
        x: 45.0,
        y: 20.0,
        width: 20.0,
        height: 20.0,
        rotation: 0.0,
        fill_color: Some("DBEAFE".to_string()),
        stroke_color: Some("2563EB".to_string()),
        stroke_width: 2.0,
        line_start_arrow: None,
        line_end_arrow: None,
    };

    let updated = regroup_pptx_slide_objects(xml, &[text], &[shape], &[], &[], &[]);

    assert!(updated.contains("<p:grpSp>"));
    assert!(updated.contains(r#"name="Group group2""#));
    assert!(updated.contains("<a:t>New</a:t>"));
    assert!(updated.contains(r#"<a:prstGeom prst="rect">"#));
    assert!(updated.contains(r#"<a:prstGeom prst="flowChartProcess">"#));
    assert!(!updated.contains("<a:t>Old</a:t>"));
}

#[test]
fn pptx_basic_shapes_replace_managed_shapes_only() {
    let xml = r#"<p:sld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr></p:grpSpPr><p:sp><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:p><a:r><a:t>Keep text</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr></p:sp><p:sp><p:spPr><a:prstGeom prst="flowChartProcess"><a:avLst/></a:prstGeom></p:spPr></p:sp></p:spTree></p:sld>"#;
    let specs = vec![
        PptxShapeSpec {
            kind: PptxShapeKind::Line,
            group_id: None,
            x: 10.0,
            y: 10.0,
            width: 30.0,
            height: 0.0,
            rotation: 0.0,
            fill_color: None,
            stroke_color: Some("111827".to_string()),
            stroke_width: 1.0,
            line_start_arrow: Some(PptxLineArrowKind::Stealth),
            line_end_arrow: Some(PptxLineArrowKind::Triangle),
        },
        PptxShapeSpec {
            kind: PptxShapeKind::Ellipse,
            group_id: None,
            x: 20.0,
            y: 20.0,
            width: 20.0,
            height: 20.0,
            rotation: 0.0,
            fill_color: Some("DBEAFE".to_string()),
            stroke_color: Some("2563EB".to_string()),
            stroke_width: 2.0,
            line_start_arrow: None,
            line_end_arrow: None,
        },
    ];

    let updated = replace_pptx_basic_shapes(xml, &specs);

    assert!(updated.contains("<a:t>Keep text</a:t>"));
    assert!(updated.contains(r#"<a:prstGeom prst="flowChartProcess">"#));
    assert!(updated.contains(r#"<a:prstGeom prst="line">"#));
    assert!(updated.contains(r#"<a:tailEnd type="stealth"/>"#));
    assert!(updated.contains(r#"<a:headEnd type="triangle"/>"#));
    assert!(updated.contains(r#"<a:prstGeom prst="ellipse">"#));
    assert!(!updated.contains(r#"<a:srgbClr val="FFFFFF"/>"#));
    assert!(updated.contains(r#"<p:cNvPr id="20000" name="Shape 20000"/>"#));
    assert!(updated.contains(r#"<p:cNvPr id="20001" name="Shape 20001"/>"#));
}

#[test]
fn pptx_basic_shapes_replace_existing_connector_segments() {
    let xml = r#"<p:sld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr></p:grpSpPr><p:cxnSp><p:nvCxnSpPr><p:cNvPr id="7" name="Old connector"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="12700"><a:solidFill><a:srgbClr val="111111"/></a:solidFill></a:ln></p:spPr></p:cxnSp></p:spTree></p:sld>"#;
    let specs = vec![PptxShapeSpec {
        kind: PptxShapeKind::StraightConnector1,
        group_id: None,
        x: 10.0,
        y: 10.0,
        width: 30.0,
        height: 0.0,
        rotation: 0.0,
        fill_color: None,
        stroke_color: Some("2563EB".to_string()),
        stroke_width: 2.0,
        line_start_arrow: None,
        line_end_arrow: Some(PptxLineArrowKind::Triangle),
    }];

    let updated = replace_pptx_basic_shapes(xml, &specs);

    assert!(updated.contains(r#"<p:cNvPr id="20000" name="Connector 20000"/>"#));
    assert!(updated.contains(r#"<a:srgbClr val="2563EB"/>"#));
    assert!(updated.contains(r#"<a:headEnd type="triangle"/>"#));
    assert!(!updated.contains("Old connector"));
    assert!(!updated.contains(r#"<a:srgbClr val="111111"/>"#));
}

#[test]
fn pptx_slide_background_reads_and_writes_solid_color() {
    let xml = r#"<p:sld><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F8FAFC"/></a:solidFill></p:bgPr></p:bg><p:spTree/></p:cSld></p:sld>"#;

    assert_eq!(pptx_slide_background_color(xml), Some("F8FAFC".to_string()));

    let background = PptxBackgroundSpec::Solid("112233".to_string());
    let updated = update_pptx_slide_background(xml, Some(&background));

    assert!(updated.contains(r#"<a:srgbClr val="112233"/>"#));
}

#[test]
fn pptx_slide_background_reads_and_writes_gradient() {
    let xml = r#"<p:sld><p:cSld><p:bg><p:bgPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="2563EB"/></a:gs></a:gsLst><a:lin ang="2700000" scaled="1"/></a:gradFill></p:bgPr></p:bg><p:spTree/></p:cSld></p:sld>"#;

    assert_eq!(
        pptx_slide_background_gradient(xml),
        Some(("FFFFFF".to_string(), "2563EB".to_string(), 45.0))
    );

    let background = PptxBackgroundSpec::Gradient {
        start_color: "F8FAFC".to_string(),
        end_color: "0F172A".to_string(),
        angle: 135.0,
    };
    let updated = update_pptx_slide_background(xml, Some(&background));

    assert!(updated.contains("<a:gradFill"));
    assert!(updated.contains(r#"<a:srgbClr val="F8FAFC"/>"#));
    assert!(updated.contains(r#"<a:srgbClr val="0F172A"/>"#));
    assert!(updated.contains(r#"<a:lin ang="8100000" scaled="1"/>"#));
}

#[test]
fn pptx_update_preserves_unedited_gradient_background() {
    let original = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        (
            "ppt/slides/slide1.xml",
            r#"<p:sld><p:cSld><p:bg><p:bgPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="2563EB"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="1"/></a:gradFill></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sld>"#,
        ),
    ]);
    let model = pptx_model(&original).expect("PPTX model should read gradient");
    let updated = update_pptx(&original, &model).expect("PPTX should save");
    let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

    assert_eq!(model["slides"][0]["backgroundKind"], "gradient");
    assert_eq!(model["slides"][0]["backgroundGradientStart"], "#FFFFFF");
    assert_eq!(model["slides"][0]["backgroundGradientEnd"], "#2563EB");
    assert!(slide.contains("<a:gradFill"));
    assert!(slide.contains(r#"<a:lin ang="5400000" scaled="1"/>"#));
}

#[test]
fn pptx_slide_visibility_reads_and_writes_hidden_flag() {
    let xml = r#"<p:sld show="0"><p:cSld><p:spTree/></p:cSld></p:sld>"#;

    assert!(pptx_slide_hidden(xml));

    let shown = update_pptx_slide_visibility(xml, Some(false));
    let hidden = update_pptx_slide_visibility(&shown, Some(true));

    assert!(shown.contains(r#"show="1""#));
    assert!(hidden.contains(r#"show="0""#));
}

#[test]
fn pptx_model_exposes_slide_transition() {
    let slide_xml = r#"<p:sld><p:cSld><p:spTree/></p:cSld><p:transition spd="slow" advClick="0" advTm="3500"><p:wipe dir="l"/></p:transition></p:sld>"#;
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml),
    ]);

    let model = pptx_model(&package).unwrap();
    let transition = &model["slides"][0]["transition"];

    assert_eq!(transition["type"], "wipe");
    assert_eq!(transition["speed"], "slow");
    assert_eq!(transition["direction"], "l");
    assert_eq!(transition["advanceOnClick"], false);
    assert_eq!(transition["advanceAfterMs"], 3500);
}

#[test]
fn pptx_update_rewrites_slide_transition() {
    let slide_xml = r#"<p:sld><p:cSld><p:spTree/></p:cSld><p:transition><p:fade/></p:transition><p:timing/></p:sld>"#;
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["slides"][0]["transition"] = json!({
        "type": "push",
        "speed": "fast",
        "direction": "l",
        "advanceOnClick": false,
        "advanceAfterMs": 2500
    });

    let updated = update_pptx(&package, &model).unwrap();
    let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

    assert!(slide.contains(r#"<p:transition spd="fast" advClick="0" advTm="2500"><p:push dir="l"/></p:transition><p:timing"#));
    assert!(!slide.contains("<p:fade/>"));
}

#[test]
fn pptx_model_exposes_and_updates_animation_timing() {
    let slide_xml = r#"<p:sld><p:cSld><p:spTree/></p:cSld><p:timing><p:tnLst><p:cTn id="1" nodeType="clickEffect" delay="250" dur="1000" presetClass="entr"><p:tgtEl><p:spTgt spid="4"/></p:tgtEl></p:cTn><p:cTn id="2" nodeType="afterEffect" delay="0" dur="500"/></p:tnLst></p:timing></p:sld>"#;
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml),
    ]);

    let mut model = pptx_model(&package).unwrap();
    assert_eq!(model["slides"][0]["animations"][0]["id"], "1");
    assert_eq!(model["slides"][0]["animations"][0]["targetShapeId"], "4");
    assert_eq!(model["slides"][0]["animations"][0]["delayMs"], 250);
    assert_eq!(model["slides"][0]["animations"][0]["durationMs"], 1000);
    model["slides"][0]["animations"][0]["delayMs"] = json!(750);
    model["slides"][0]["animations"][0]["durationMs"] = json!(1250);
    let updated = update_pptx(&package, &model).unwrap();
    let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

    assert!(slide.contains(r#"id="1" nodeType="clickEffect" delay="750" dur="1250""#));
    assert!(slide.contains(r#"<p:spTgt spid="4"/>"#));
    assert!(slide.contains(r#"id="2" nodeType="afterEffect" delay="0" dur="500""#));
}

#[test]
fn pptx_model_exposes_slide_media_metadata() {
    let slide_xml = pptx_test_slide_with_media_xml("rIdVideo");
    let package = test_ooxml_package(&[
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rIdVideo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/video" Target="../media/movie1.mp4"/></Relationships>"#,
        ),
        ("ppt/media/movie1.mp4", "video-bytes"),
    ]);

    let model = pptx_model(&package).unwrap();
    let media = &model["slides"][0]["media"][0];

    assert_eq!(media["kind"], "video");
    assert_eq!(media["relationshipId"], "rIdVideo");
    assert_eq!(media["mediaPath"], "ppt/media/movie1.mp4");
    assert_eq!(media["mimeType"], "video/mp4");
    assert_eq!(media["shapeId"], "6");
    assert_eq!(media["timingIndex"], 0);
    assert_eq!(media["volumePercent"], 75.0);
    assert_eq!(media["muted"], false);
    assert_eq!(media["showWhenStopped"], true);
    assert_eq!(media["delayMs"], 250);
    assert_eq!(media["durationMs"], 2000);
}

#[test]
fn pptx_update_writes_slide_media_playback_metadata() {
    let slide_xml = pptx_test_slide_with_media_xml("rIdVideo");
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rIdVideo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/video" Target="../media/movie1.mp4"/></Relationships>"#,
        ),
        ("ppt/media/movie1.mp4", "video-bytes"),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["slides"][0]["media"][0]["volumePercent"] = json!(35.0);
    model["slides"][0]["media"][0]["muted"] = json!(true);
    model["slides"][0]["media"][0]["showWhenStopped"] = json!(false);
    model["slides"][0]["media"][0]["delayMs"] = json!(500);
    model["slides"][0]["media"][0]["durationMs"] = json!(3000);

    let updated = update_pptx(&package, &model).unwrap();
    let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

    assert!(slide.contains(r#"<p:cMediaNode vol="35000" mute="1" showWhenStopped="0">"#));
    assert!(slide.contains(r#"<p:cTn id="7" delay="500" dur="3000">"#));
    assert!(read_zip_bytes(&updated, "ppt/media/movie1.mp4").is_ok());
}

#[test]
fn pptx_update_reorders_animation_timing_segments() {
    let slide_xml = r#"<p:sld><p:cSld><p:spTree/></p:cSld><p:timing><p:tnLst><p:cTn id="1" delay="0" dur="100"/><p:cTn id="2" delay="100" dur="200"/></p:tnLst></p:timing></p:sld>"#;
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml),
    ]);

    let mut model = pptx_model(&package).unwrap();
    let first = model["slides"][0]["animations"][0].clone();
    model["slides"][0]["animations"][0] = model["slides"][0]["animations"][1].clone();
    model["slides"][0]["animations"][1] = first;
    let updated = update_pptx(&package, &model).unwrap();
    let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

    assert!(slide.find(r#"id="2""#).unwrap() < slide.find(r#"id="1""#).unwrap());
}

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
fn pptx_model_exposes_slide_images() {
    let slide_xml = pptx_test_slide_with_image_xml("rIdImage", "Original alt");
    let package = test_ooxml_package(&[
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>"#,
        ),
        ("ppt/media/image1.png", "png-bytes"),
    ]);

    let model = pptx_model(&package).unwrap();
    let image = &model["slides"][0]["images"][0];

    assert_eq!(image["relationshipId"], "rIdImage");
    assert_eq!(image["mediaPath"], "ppt/media/image1.png");
    assert_eq!(image["mimeType"], "image/png");
    assert_eq!(image["altText"], "Original alt");
    assert_eq!(image["x"], 10.0);
    assert_eq!(image["y"], 10.0);
    assert_eq!(image["width"], 20.0);
    assert_eq!(image["height"], 20.0);
    assert_eq!(image["imageCropLeft"], 3.0);
    assert_eq!(image["imageCropTop"], 4.0);
    assert_eq!(image["imageCropRight"], 5.0);
    assert_eq!(image["imageCropBottom"], 6.0);
    assert!(image["dataUrl"]
        .as_str()
        .unwrap()
        .starts_with("data:image/png;base64,"));
}

#[test]
fn pptx_model_exposes_slide_background_image() {
    let slide_xml = r#"<p:sld><p:cSld><p:bg><p:bgPr><a:blipFill><a:blip r:embed="rIdBg"/><a:stretch><a:fillRect/></a:stretch></a:blipFill></p:bgPr></p:bg><p:spTree/></p:cSld></p:sld>"#;
    let package = test_ooxml_package(&[
        ("ppt/slides/slide1.xml", slide_xml),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rIdBg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/bg.png"/></Relationships>"#,
        ),
        ("ppt/media/bg.png", "png-bytes"),
    ]);

    let model = pptx_model(&package).unwrap();
    let slide = &model["slides"][0];

    assert_eq!(slide["backgroundKind"], "image");
    assert_eq!(slide["backgroundImageRelationshipId"], "rIdBg");
    assert_eq!(slide["backgroundImageMediaPath"], "ppt/media/bg.png");
    assert_eq!(slide["backgroundImageMimeType"], "image/png");
    assert!(slide["backgroundImageDataUrl"]
        .as_str()
        .unwrap()
        .starts_with("data:image/png;base64,"));
}

#[test]
fn pptx_update_rewrites_existing_image_geometry_and_alt_text() {
    let slide_xml = pptx_test_slide_with_image_xml("rIdImage", "Original alt");
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>"#,
        ),
        ("ppt/media/image1.png", "png-bytes"),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["slides"][0]["images"][0]["x"] = json!(20.0);
    model["slides"][0]["images"][0]["y"] = json!(30.0);
    model["slides"][0]["images"][0]["width"] = json!(40.0);
    model["slides"][0]["images"][0]["height"] = json!(50.0);
    model["slides"][0]["images"][0]["rotation"] = json!(15.0);
    model["slides"][0]["images"][0]["imageCropLeft"] = json!(7.0);
    model["slides"][0]["images"][0]["imageCropTop"] = json!(8.0);
    model["slides"][0]["images"][0]["imageCropRight"] = json!(9.0);
    model["slides"][0]["images"][0]["imageCropBottom"] = json!(10.0);
    model["slides"][0]["images"][0]["altText"] = json!("Updated alt");

    let updated = update_pptx(&package, &model).unwrap();
    let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

    assert!(slide.contains(r#"<a:off x="1828800" y="1543050"/>"#));
    assert!(slide.contains(r#"<a:ext cx="3657600" cy="2571750"/>"#));
    assert!(slide.contains(r#"<a:xfrm rot="900000">"#));
    assert!(slide.contains(r#"<a:srcRect l="7000" t="8000" r="9000" b="10000"/>"#));
    assert!(slide.contains(r#"descr="Updated alt""#));
    assert!(slide.contains(r#"title="Updated alt""#));
    assert!(read_zip_bytes(&updated, "ppt/media/image1.png").is_ok());
}

#[test]
fn pptx_update_inserts_slide_background_image_relationship() {
    let slide_xml = pptx_test_slide_xml("Title");
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#,
        ),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["slides"][0]["backgroundKind"] = json!("image");
    model["slides"][0]["backgroundImageDataUrl"] = json!("data:image/png;base64,YmctaW1hZ2U=");

    let updated = update_pptx(&package, &model).unwrap();
    let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();
    let rels = read_zip_text(&updated, "ppt/slides/_rels/slide1.xml.rels").unwrap();
    let content_types = read_zip_text(&updated, "[Content_Types].xml").unwrap();

    assert!(slide.contains("<a:blipFill>"));
    assert!(slide.contains(r#"<a:blip r:embed="rId1"/>"#));
    assert!(rels.contains("relationships/image"));
    assert!(rels.contains(r#"Target="../media/mymy-image-1.png""#));
    assert!(content_types.contains(r#"Extension="png" ContentType="image/png""#));
    assert_eq!(
        read_zip_bytes(&updated, "ppt/media/mymy-image-1.png").unwrap(),
        b"bg-image"
    );
}

#[test]
fn pptx_update_inserts_image_media_relationship_and_keeps_notes_relationship() {
    let slide_xml = pptx_test_slide_xml("Title");
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#,
        ),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["slides"][0]["images"] = json!([{
        "id": "img1",
        "dataUrl": "data:image/png;base64,cG5nLWJ5dGVz",
        "x": 12.0,
        "y": 14.0,
        "width": 30.0,
        "height": 20.0,
        "imageCropLeft": 1.0,
        "imageCropTop": 2.0,
        "imageCropRight": 3.0,
        "imageCropBottom": 4.0,
        "altText": "Inserted image"
    }]);
    model["slides"][0]["notes"] = json!("Remember the inserted image");

    let updated = update_pptx(&package, &model).unwrap();
    let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();
    let rels = read_zip_text(&updated, "ppt/slides/_rels/slide1.xml.rels").unwrap();
    let content_types = read_zip_text(&updated, "[Content_Types].xml").unwrap();

    assert_eq!(
        read_zip_bytes(&updated, "ppt/media/mymy-image-1.png").unwrap(),
        b"png-bytes"
    );
    assert!(slide.contains("<p:pic>"));
    assert!(slide.contains(r#"descr="Inserted image""#));
    assert!(slide.contains(r#"<a:srcRect l="1000" t="2000" r="3000" b="4000"/>"#));
    assert!(slide.contains(r#"r:embed="rId1""#));
    assert!(rels.contains("relationships/image"));
    assert!(rels.contains(r#"Target="../media/mymy-image-1.png""#));
    assert!(rels.contains("relationships/notesSlide"));
    assert!(content_types.contains(r#"Extension="png" ContentType="image/png""#));
    assert!(content_types.contains("presentationml.notesSlide+xml"));
}

#[test]
fn pptx_update_builds_new_slide_with_inserted_image_relationship() {
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
    model["slides"].as_array_mut().unwrap().push(json!({
        "id": "ppt/slides/slide2.xml",
        "texts": [{
            "id": "t1",
            "text": "Duplicated slide",
            "x": 10.0,
            "y": 12.0,
            "width": 80.0,
            "height": 10.0
        }],
        "images": [{
            "id": "img1",
            "dataUrl": "data:image/png;base64,cG5nLWJ5dGVz",
            "x": 20.0,
            "y": 20.0,
            "width": 25.0,
            "height": 25.0,
            "altText": "Slide copy image"
        }]
    }));

    let updated = update_pptx(&package, &model).unwrap();
    let slide = read_zip_text(&updated, "ppt/slides/slide2.xml").unwrap();
    let rels = read_zip_text(&updated, "ppt/slides/_rels/slide2.xml.rels").unwrap();
    let presentation_rels = read_zip_text(&updated, "ppt/_rels/presentation.xml.rels").unwrap();

    assert!(slide.contains("Duplicated slide"));
    assert!(slide.contains("<p:pic>"));
    assert!(slide.contains(r#"descr="Slide copy image""#));
    assert!(rels.contains("relationships/image"));
    assert!(rels.contains(r#"Target="../media/mymy-image-1.png""#));
    assert!(presentation_rels.contains(r#"Target="slides/slide2.xml""#));
    assert_eq!(
        read_zip_bytes(&updated, "ppt/media/mymy-image-1.png").unwrap(),
        b"png-bytes"
    );
}

#[test]
fn pptx_update_removes_deleted_image_segments() {
    let slide_xml = pptx_test_slide_with_image_xml("rIdImage", "Original alt");
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>"#,
        ),
        ("ppt/media/image1.png", "png-bytes"),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["slides"][0]["images"] = json!([]);

    let updated = update_pptx(&package, &model).unwrap();
    let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

    assert!(!slide.contains("<p:pic"));
    assert!(read_zip_bytes(&updated, "ppt/media/image1.png").is_ok());
}

#[test]
fn pptx_model_exposes_slide_charts() {
    let slide_xml = pptx_test_slide_with_chart_xml("rIdChart");
    let chart_xml = pptx_test_chart_xml("Revenue", "Q1", "120");
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>"#,
        ),
        ("ppt/charts/chart1.xml", chart_xml.as_str()),
    ]);

    let model = pptx_model(&package).unwrap();
    let chart = &model["slides"][0]["charts"][0];

    assert_eq!(chart["relationshipId"], "rIdChart");
    assert_eq!(chart["path"], "ppt/charts/chart1.xml");
    assert_eq!(chart["type"], "bar");
    assert_eq!(chart["title"], "Revenue");
    assert_eq!(chart["legendVisible"], true);
    assert_eq!(chart["legendPosition"], "r");
    assert_eq!(chart["categoryAxisTitle"], "Quarter");
    assert_eq!(chart["valueAxisTitle"], "Amount");
    assert_eq!(chart["categoryAxisPosition"], "b");
    assert_eq!(chart["valueAxisPosition"], "l");
    assert_eq!(chart["categoryMajorGridlines"], false);
    assert_eq!(chart["valueMajorGridlines"], true);
    assert_eq!(chart["categoryAxisTickLabelPosition"], "nextTo");
    assert_eq!(chart["categoryAxisMajorTickMark"], "out");
    assert_eq!(chart["categoryAxisMinorTickMark"], "none");
    assert_eq!(chart["categoryAxisNumberFormat"], "mmm yyyy");
    assert_eq!(chart["categoryAxisLineColor"], "#64748B");
    assert_eq!(chart["categoryAxisLineWidth"], 2.0);
    assert_eq!(chart["categoryAxisLineDash"], "dash");
    assert_eq!(chart["categoryAxisLabelTextColor"], "#222222");
    assert_eq!(chart["categoryAxisLabelFontSize"], 9);
    assert_eq!(chart["categoryAxisLabelRotation"], 30.0);
    assert_eq!(chart["categoryAxisLabelBold"], false);
    assert_eq!(chart["categoryAxisLabelItalic"], true);
    assert_eq!(chart["valueAxisNumberFormat"], "#,##0");
    assert_eq!(chart["valueAxisLineColor"], "#94A3B8");
    assert_eq!(chart["valueAxisLineWidth"], 3.0);
    assert_eq!(chart["valueAxisLineDash"], "dot");
    assert_eq!(chart["valueAxisLabelRotation"], -45.0);
    assert_eq!(chart["categories"][0], "Q1");
    assert_eq!(chart["series"][0]["values"][0], "120");
    assert_eq!(chart["x"], 10.0);
    assert_eq!(chart["y"], 10.0);
    assert_eq!(chart["width"], 40.0);
    assert_eq!(chart["height"], 30.0);
}

#[test]
fn pptx_update_rewrites_existing_chart_geometry_and_title() {
    let slide_xml = pptx_test_slide_with_chart_xml("rIdChart");
    let chart_xml = pptx_test_chart_xml("Revenue", "Q1", "120");
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>"#,
        ),
        ("ppt/charts/chart1.xml", chart_xml.as_str()),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["slides"][0]["charts"][0]["x"] = json!(25.0);
    model["slides"][0]["charts"][0]["y"] = json!(20.0);
    model["slides"][0]["charts"][0]["width"] = json!(50.0);
    model["slides"][0]["charts"][0]["height"] = json!(40.0);
    model["slides"][0]["charts"][0]["rotation"] = json!(30.0);
    model["slides"][0]["charts"][0]["title"] = json!("Updated chart");
    model["slides"][0]["charts"][0]["series"][0]["name"] = json!("Updated series");
    model["slides"][0]["charts"][0]["series"][0]["categories"][0] = json!("Q2");
    model["slides"][0]["charts"][0]["series"][0]["values"][0] = json!("240");

    let updated = update_pptx(&package, &model).unwrap();
    let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();
    let chart = read_zip_text(&updated, "ppt/charts/chart1.xml").unwrap();

    assert!(slide.contains(r#"x="2286000""#));
    assert!(slide.contains(r#"y="1028700""#));
    assert!(slide.contains(r#"cx="4572000""#));
    assert!(slide.contains(r#"cy="2057400""#));
    assert!(slide.contains(r#"rot="1800000""#));
    assert!(chart.contains(">Updated chart<"));
    assert!(!chart.contains(">Revenue<"));
    assert!(chart.contains(">Updated series<"));
    assert!(chart.contains(">Q2<"));
    assert!(chart.contains(">240<"));
    assert!(!chart.contains(">120<"));
}

#[test]
fn pptx_update_rewrites_chart_type() {
    let slide_xml = pptx_test_slide_with_chart_xml("rIdChart");
    let chart_xml = pptx_test_chart_xml("Revenue", "Q1", "120");
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>"#,
        ),
        ("ppt/charts/chart1.xml", chart_xml.as_str()),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["slides"][0]["charts"][0]["type"] = json!("line");

    let updated = update_pptx(&package, &model).unwrap();
    let chart = read_zip_text(&updated, "ppt/charts/chart1.xml").unwrap();

    assert!(chart.contains("<c:lineChart>"));
    assert!(!chart.contains("<c:barChart>"));
}

#[test]
fn pptx_update_rewrites_chart_legend_and_axis_titles() {
    let slide_xml = pptx_test_slide_with_chart_xml("rIdChart");
    let chart_xml = pptx_test_chart_xml("Revenue", "Q1", "120");
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>"#,
        ),
        ("ppt/charts/chart1.xml", chart_xml.as_str()),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["slides"][0]["charts"][0]["legendVisible"] = json!(true);
    model["slides"][0]["charts"][0]["legendPosition"] = json!("b");
    model["slides"][0]["charts"][0]["categoryAxisTitle"] = json!("Month");
    model["slides"][0]["charts"][0]["valueAxisTitle"] = json!("Profit");

    let updated = update_pptx(&package, &model).unwrap();
    let chart = read_zip_text(&updated, "ppt/charts/chart1.xml").unwrap();

    assert!(chart.contains(r#"<c:legendPos val="b"/>"#));
    assert!(chart.contains(">Month<"));
    assert!(chart.contains(">Profit<"));
    assert!(!chart.contains(">Quarter<"));
    assert!(!chart.contains(">Amount<"));
}

#[test]
fn pptx_update_removes_chart_legend() {
    let slide_xml = pptx_test_slide_with_chart_xml("rIdChart");
    let chart_xml = pptx_test_chart_xml("Revenue", "Q1", "120");
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>"#,
        ),
        ("ppt/charts/chart1.xml", chart_xml.as_str()),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["slides"][0]["charts"][0]["legendVisible"] = json!(false);

    let updated = update_pptx(&package, &model).unwrap();
    let chart = read_zip_text(&updated, "ppt/charts/chart1.xml").unwrap();

    assert!(!chart.contains("<c:legend>"));
}

#[test]
fn pptx_update_rewrites_chart_axis_style() {
    let slide_xml = pptx_test_slide_with_chart_xml("rIdChart");
    let chart_xml = pptx_test_chart_xml("Revenue", "Q1", "120");
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>"#,
        ),
        ("ppt/charts/chart1.xml", chart_xml.as_str()),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["slides"][0]["charts"][0]["categoryAxisPosition"] = json!("t");
    model["slides"][0]["charts"][0]["valueAxisPosition"] = json!("r");
    model["slides"][0]["charts"][0]["categoryMajorGridlines"] = json!(true);
    model["slides"][0]["charts"][0]["valueMajorGridlines"] = json!(false);
    model["slides"][0]["charts"][0]["categoryAxisTickLabelPosition"] = json!("high");
    model["slides"][0]["charts"][0]["valueAxisTickLabelPosition"] = json!("none");
    model["slides"][0]["charts"][0]["categoryAxisMajorTickMark"] = json!("in");
    model["slides"][0]["charts"][0]["valueAxisMajorTickMark"] = json!("out");
    model["slides"][0]["charts"][0]["categoryAxisMinorTickMark"] = json!("cross");
    model["slides"][0]["charts"][0]["valueAxisMinorTickMark"] = json!("none");
    model["slides"][0]["charts"][0]["categoryAxisNumberFormat"] = json!("#,##0.0");
    model["slides"][0]["charts"][0]["valueAxisNumberFormat"] = json!("0%");
    model["slides"][0]["charts"][0]["categoryAxisLineColor"] = json!("#0F172A");
    model["slides"][0]["charts"][0]["valueAxisLineColor"] = json!("#334155");
    model["slides"][0]["charts"][0]["categoryAxisLineWidth"] = json!(2.5);
    model["slides"][0]["charts"][0]["valueAxisLineWidth"] = json!(3.0);
    model["slides"][0]["charts"][0]["categoryAxisLineDash"] = json!("dashDot");
    model["slides"][0]["charts"][0]["valueAxisLineDash"] = json!("dot");
    model["slides"][0]["charts"][0]["categoryAxisLabelTextColor"] = json!("#7C3AED");
    model["slides"][0]["charts"][0]["valueAxisLabelTextColor"] = json!("#F97316");
    model["slides"][0]["charts"][0]["categoryAxisLabelFontSize"] = json!(11);
    model["slides"][0]["charts"][0]["valueAxisLabelFontSize"] = json!(12);
    model["slides"][0]["charts"][0]["categoryAxisLabelRotation"] = json!(45.0);
    model["slides"][0]["charts"][0]["valueAxisLabelRotation"] = json!(-30.0);
    model["slides"][0]["charts"][0]["categoryAxisLabelBold"] = json!(true);
    model["slides"][0]["charts"][0]["valueAxisLabelBold"] = json!(false);
    model["slides"][0]["charts"][0]["categoryAxisLabelItalic"] = json!(false);
    model["slides"][0]["charts"][0]["valueAxisLabelItalic"] = json!(true);

    let updated = update_pptx(&package, &model).unwrap();
    let chart = read_zip_text(&updated, "ppt/charts/chart1.xml").unwrap();
    let category_axis = xml_named_segments(&chart, "c:catAx")
        .into_iter()
        .next()
        .unwrap();
    let value_axis = xml_named_segments(&chart, "c:valAx")
        .into_iter()
        .next()
        .unwrap();

    assert!(category_axis.contains(r#"<c:axPos val="t"/>"#));
    assert!(category_axis.contains("<c:majorGridlines/>"));
    assert!(category_axis.contains(r#"<c:tickLblPos val="high"/>"#));
    assert!(category_axis.contains(r#"<c:majorTickMark val="in"/>"#));
    assert!(category_axis.contains(r#"<c:minorTickMark val="cross"/>"#));
    assert!(category_axis.contains(r##"<c:numFmt formatCode="#,##0.0" sourceLinked="0"/>"##));
    assert!(category_axis.contains(r#"<a:ln w="31750">"#));
    assert!(category_axis.contains(r#"<a:srgbClr val="0F172A"/>"#));
    assert!(category_axis.contains(r#"<a:prstDash val="dashDot"/>"#));
    assert!(category_axis.contains(r#"<a:bodyPr rot="2700000"/>"#));
    assert!(category_axis.contains(
        r#"<a:defRPr sz="1100" b="1" i="0"><a:solidFill><a:srgbClr val="7C3AED"/></a:solidFill></a:defRPr>"#
    ));
    assert!(value_axis.contains(r#"<c:axPos val="r"/>"#));
    assert!(!value_axis.contains("<c:majorGridlines"));
    assert!(value_axis.contains(r#"<c:tickLblPos val="none"/>"#));
    assert!(value_axis.contains(r#"<c:majorTickMark val="out"/>"#));
    assert!(value_axis.contains(r#"<c:minorTickMark val="none"/>"#));
    assert!(value_axis.contains(r#"<c:numFmt formatCode="0%" sourceLinked="0"/>"#));
    assert!(value_axis.contains(r#"<a:ln w="38100">"#));
    assert!(value_axis.contains(r#"<a:srgbClr val="334155"/>"#));
    assert!(value_axis.contains(r#"<a:prstDash val="dot"/>"#));
    assert!(value_axis.contains(r#"<a:bodyPr rot="-1800000"/>"#));
    assert!(value_axis.contains(
        r#"<a:defRPr sz="1200" b="0" i="1"><a:solidFill><a:srgbClr val="F97316"/></a:solidFill></a:defRPr>"#
    ));
}

#[test]
fn pptx_update_inserts_duplicate_chart_frame_with_cloned_chart_part() {
    let slide_xml = pptx_test_slide_with_chart_xml("rIdChart");
    let chart_xml = pptx_test_chart_xml("Revenue", "Q1", "120");
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>"#,
        ),
        ("ppt/charts/chart1.xml", chart_xml.as_str()),
    ]);
    let mut model = pptx_model(&package).unwrap();
    let duplicate = json!({
        "id": "chart2",
        "path": "ppt/charts/chart1.xml",
        "title": "Revenue copy",
        "x": 52.0,
        "y": 20.0,
        "width": 32.0,
        "height": 24.0
    });
    model["slides"][0]["charts"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);

    let updated = update_pptx(&package, &model).unwrap();
    let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();
    let rels = read_zip_text(&updated, "ppt/slides/_rels/slide1.xml.rels").unwrap();
    let content_types = read_zip_text(&updated, "[Content_Types].xml").unwrap();
    let cloned_chart = read_zip_text(&updated, "ppt/charts/mymy-chart-1.xml").unwrap();

    assert_eq!(slide.matches("<p:graphicFrame>").count(), 2);
    assert_eq!(slide.matches(r#"<c:chart r:id="rIdChart"/>"#).count(), 1);
    assert_eq!(slide.matches(r#"<c:chart r:id="rId1"/>"#).count(), 1);
    assert!(slide.contains(r#"x="4754880""#));
    assert!(slide.contains(r#"y="1028700""#));
    assert!(slide.contains(r#"cx="2926080""#));
    assert!(slide.contains(r#"cy="1234440""#));
    assert!(rels.contains(r#"Id="rId1""#));
    assert!(rels.contains(r#"Target="../charts/mymy-chart-1.xml""#));
    assert!(content_types.contains(r#"PartName="/ppt/charts/mymy-chart-1.xml""#));
    assert!(cloned_chart.contains(">Revenue copy<"));
    assert!(cloned_chart.contains(">Q1<"));
    assert!(cloned_chart.contains(">120<"));
}

#[test]
fn pptx_update_removes_deleted_chart_frames() {
    let slide_xml = pptx_test_slide_with_chart_xml("rIdChart");
    let chart_xml = pptx_test_chart_xml("Revenue", "Q1", "120");
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(false)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>"#,
        ),
        ("ppt/charts/chart1.xml", chart_xml.as_str()),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["slides"][0]["charts"] = json!([]);

    let updated = update_pptx(&package, &model).unwrap();
    let slide = read_zip_text(&updated, "ppt/slides/slide1.xml").unwrap();

    assert!(!slide.contains("<p:graphicFrame"));
    assert!(read_zip_text(&updated, "ppt/charts/chart1.xml").is_ok());
}

#[test]
fn pptx_model_exposes_speaker_notes() {
    let slide_xml = pptx_test_slide_xml("Title");
    let notes_xml = pptx_test_notes_xml("Remember this");
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(true)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>"#,
        ),
        ("ppt/notesSlides/notesSlide1.xml", notes_xml.as_str()),
    ]);

    let model = pptx_model(&package).unwrap();

    assert_eq!(model["slides"][0]["notes"], "Remember this");
}

#[test]
fn pptx_update_rewrites_existing_speaker_notes() {
    let slide_xml = pptx_test_slide_xml("Title");
    let notes_xml = pptx_test_notes_xml("Old note");
    let package = test_ooxml_package(&[
        ("[Content_Types].xml", pptx_test_content_types(true)),
        ("ppt/presentation.xml", pptx_test_presentation_xml()),
        (
            "ppt/_rels/presentation.xml.rels",
            pptx_test_presentation_rels(),
        ),
        ("ppt/slides/slide1.xml", slide_xml.as_str()),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>"#,
        ),
        ("ppt/notesSlides/notesSlide1.xml", notes_xml.as_str()),
    ]);
    let mut model = pptx_model(&package).unwrap();
    model["slides"][0]["notes"] = json!("New note");

    let updated = update_pptx(&package, &model).unwrap();
    let notes = read_zip_text(&updated, "ppt/notesSlides/notesSlide1.xml").unwrap();

    assert!(notes.contains("<a:t>New note</a:t>"));
    assert!(!notes.contains("Old note"));
}

#[test]
fn pptx_update_adds_speaker_notes_relationship_and_content_type() {
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
    let model = json!({
        "slides": [{
            "id": "ppt/slides/slide1.xml",
            "name": "slide1.xml",
            "texts": [{"id": "t1", "text": "Title"}],
            "notes": "Fresh note"
        }]
    });

    let updated = update_pptx(&package, &model).unwrap();
    let rels = read_zip_text(&updated, "ppt/slides/_rels/slide1.xml.rels").unwrap();
    let notes = read_zip_text(&updated, "ppt/notesSlides/notesSlide1.xml").unwrap();
    let content_types = read_zip_text(&updated, "[Content_Types].xml").unwrap();

    assert!(rels.contains(
        r#"Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide""#
    ));
    assert!(rels.contains(r#"Target="../notesSlides/notesSlide1.xml""#));
    assert!(notes.contains("<a:t>Fresh note</a:t>"));
    assert!(content_types.contains(r#"PartName="/ppt/notesSlides/notesSlide1.xml""#));
    assert!(content_types.contains("presentationml.notesSlide+xml"));
}
