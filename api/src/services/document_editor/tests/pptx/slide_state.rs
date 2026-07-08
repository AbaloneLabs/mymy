use super::super::super::*;
use super::super::common::*;

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
