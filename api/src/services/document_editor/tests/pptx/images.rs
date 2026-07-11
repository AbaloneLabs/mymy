use super::super::super::*;
use super::super::common::*;

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

    assert_eq!(image["shapeId"], "7");
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
