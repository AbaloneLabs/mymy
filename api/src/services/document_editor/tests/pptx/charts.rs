use super::super::super::*;
use super::super::common::*;

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

    assert_eq!(chart["shapeId"], "8");
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
