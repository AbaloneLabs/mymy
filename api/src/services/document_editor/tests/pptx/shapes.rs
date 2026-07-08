use super::super::super::*;

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

    let xml = build_pptx_text_shape_for_size(7, &spec, PptxSlideSize::default());

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
    let texts = pptx_shape_texts_for_size(xml, PptxSlideSize::default());
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
    let updated = update_pptx_shape_geometries_for_size(xml, &[spec], PptxSlideSize::default());

    assert!(updated.contains(r#"<a:off x="1828800" y="1543050"/>"#));
    assert!(updated.contains(r#"<a:ext cx="3657600" cy="2571750"/>"#));
    assert!(updated.contains(r#"<a:xfrm rot="2700000">"#));
}

#[test]
fn pptx_basic_shape_model_reads_fill_stroke_and_geometry() {
    let xml = r##"<p:sld><p:sp><p:spPr><a:xfrm rot="900000"><a:off x="914400" y="514350"/><a:ext cx="1828800" cy="1028700"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="DBEAFE"/></a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill></a:ln></p:spPr></p:sp><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="1"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:srgbClr val="111827"/></a:solidFill><a:tailEnd type="diamond"/><a:headEnd type="triangle"/></a:ln></p:spPr></p:sp></p:sld>"##;

    let shapes = pptx_slide_shapes_for_size(xml, PptxSlideSize::default());

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

    let shapes = pptx_slide_shapes_for_size(xml, PptxSlideSize::default());

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

    let xml = build_pptx_basic_shape_for_size(9, &spec, PptxSlideSize::default());

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

    let xml = build_pptx_basic_shape_for_size(9, &spec, PptxSlideSize::default());

    assert!(xml.contains("<p:cxnSp>"));
    assert!(xml.contains("<p:cNvCxnSpPr/>"));
    assert!(xml.contains(r#"<a:prstGeom prst="straightConnector1">"#));
    assert!(xml.contains(r#"<a:headEnd type="triangle"/>"#));
}

#[test]
fn pptx_group_shape_model_reads_group_ids() {
    let xml = r##"<p:sld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/></p:nvGrpSpPr><p:grpSpPr/><p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="Group group7"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="914400" y="514350"/><a:ext cx="3657600" cy="1543050"/><a:chOff x="914400" y="514350"/><a:chExt cx="3657600" cy="1543050"/></a:xfrm></p:grpSpPr><p:sp><p:spPr><a:xfrm><a:off x="914400" y="514350"/><a:ext cx="1828800" cy="514350"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:p><a:r><a:t>Grouped text</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:spPr><a:xfrm><a:off x="2743200" y="1028700"/><a:ext cx="1828800" cy="1028700"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="DBEAFE"/></a:solidFill></p:spPr></p:sp></p:grpSp></p:spTree></p:sld>"##;

    let texts = pptx_shape_texts_for_size(xml, PptxSlideSize::default());
    let shapes = pptx_slide_shapes_for_size(xml, PptxSlideSize::default());

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

    let xml = build_pptx_slide_for_size(
        &[text],
        &[shape],
        &[],
        &[],
        &[],
        None,
        PptxSlideSize::default(),
    );

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

    let updated = regroup_pptx_slide_objects_for_size(
        xml,
        &[text],
        &[shape],
        &[],
        &[],
        &[],
        PptxSlideSize::default(),
    );

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

    let updated = replace_pptx_basic_shapes_for_size(xml, &specs, PptxSlideSize::default());

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

    let updated = replace_pptx_basic_shapes_for_size(xml, &specs, PptxSlideSize::default());

    assert!(updated.contains(r#"<p:cNvPr id="20000" name="Connector 20000"/>"#));
    assert!(updated.contains(r#"<a:srgbClr val="2563EB"/>"#));
    assert!(updated.contains(r#"<a:headEnd type="triangle"/>"#));
    assert!(!updated.contains("Old connector"));
    assert!(!updated.contains(r#"<a:srgbClr val="111111"/>"#));
}
