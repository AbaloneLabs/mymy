use super::super::super::*;
use super::super::common::*;

#[test]
fn docx_model_exposes_inline_images() {
    let bytes = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/><wp:docPr id="1" name="Picture 1" descr="Diagram"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId7"/><a:srcRect l="5000" t="10000" r="15000" b="20000"/></pic:blipFill><pic:spPr><a:xfrm rot="2700000"><a:ext cx="952500" cy="476250"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>"#,
        ),
        (
            "word/_rels/document.xml.rels",
            r#"<Relationships><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>"#,
        ),
        ("word/media/image1.png", "png-bytes"),
    ]);

    let model = docx_model(&bytes).expect("DOCX image model should parse");
    let block = &model["blocks"][0];

    assert_eq!(block["type"], "image");
    assert_eq!(block["relationshipId"], "rId7");
    assert_eq!(block["mediaPath"], "word/media/image1.png");
    assert_eq!(block["mimeType"], "image/png");
    assert_eq!(block["width"], 100);
    assert_eq!(block["height"], 50);
    assert_eq!(block["imageRotation"], 45);
    assert_eq!(block["imageCropLeft"], 5.0);
    assert_eq!(block["imageCropTop"], 10.0);
    assert_eq!(block["imageCropRight"], 15.0);
    assert_eq!(block["imageCropBottom"], 20.0);
    assert_eq!(block["imageWrap"], "inline");
    assert_eq!(block["altText"], "Diagram");
    assert!(block["dataUrl"]
        .as_str()
        .expect("image data URL")
        .starts_with("data:image/png;base64,"));
}

#[test]
fn docx_image_block_updates_extent_and_alt_text() {
    let source_xml = r#"<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/><wp:docPr id="1" name="Picture 1" descr="Diagram"/><a:graphic><a:graphicData><pic:pic><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="476250"/></a:xfrm></pic:spPr><pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#;
    let block = json!({
        "type": "image",
        "relationshipId": "rId7",
        "width": 120,
        "height": 80,
        "imageRotation": 90,
        "imageCropLeft": 2.5,
        "imageCropTop": 5,
        "imageCropRight": 7.5,
        "imageCropBottom": 10,
        "altText": "Updated diagram",
        "sourceXml": source_xml,
    });

    let xml = build_docx_image_paragraph(&block);

    assert!(xml.contains(r#"<wp:extent cx="1143000" cy="762000"/>"#));
    assert!(xml.contains(r#"<a:ext cx="1143000" cy="762000"/>"#));
    assert!(xml.contains(r#"descr="Updated diagram""#));
    assert!(xml.contains(r#"title="Updated diagram""#));
    assert!(xml.contains(r#"<a:xfrm rot="5400000">"#));
    assert!(xml.contains(r#"<a:srcRect l="2500" t="5000" r="7500" b="10000"/>"#));
    assert!(xml.contains(r#"r:embed="rId7""#));
}

#[test]
fn docx_image_block_writes_anchor_wrap_modes() {
    let block = json!({
        "type": "image",
        "relationshipId": "rId7",
        "width": 120,
        "height": 80,
        "imageWrap": "square",
        "altText": "Wrapped diagram"
    });

    let xml = build_docx_image_paragraph(&block);

    assert!(xml.contains("<wp:anchor"));
    assert!(xml.contains(r#"behindDoc="0""#));
    assert!(xml.contains(r#"<wp:wrapSquare wrapText="bothSides"/>"#));
    assert!(xml.contains(r#"descr="Wrapped diagram""#));

    let behind_xml = build_docx_image_paragraph(&json!({
        "type": "image",
        "relationshipId": "rId7",
        "width": 120,
        "height": 80,
        "imageWrap": "behind"
    }));
    assert!(behind_xml.contains(r#"behindDoc="1""#));
    assert!(behind_xml.contains("<wp:wrapNone/>"));
}

#[test]
fn docx_model_exposes_anchor_image_wrap() {
    let bytes = test_ooxml_package(&[
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:drawing><wp:anchor behindDoc="0"><wp:extent cx="952500" cy="476250"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="Picture 1"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill><pic:spPr><a:xfrm><a:ext cx="952500" cy="476250"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p></w:body></w:document>"#,
        ),
        (
            "word/_rels/document.xml.rels",
            r#"<Relationships><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>"#,
        ),
        ("word/media/image1.png", "png-bytes"),
    ]);

    let model = docx_model(&bytes).expect("DOCX anchor image model should parse");

    assert_eq!(model["blocks"][0]["imageWrap"], "square");
}

#[test]
fn docx_inserted_image_adds_media_relationship_and_content_type() {
    let original = test_ooxml_package(&[
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
        ),
        (
            "word/_rels/document.xml.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#,
        ),
        (
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>Old</w:t></w:r></w:p></w:body></w:document>"#,
        ),
    ]);
    let updated = update_docx(
        &original,
        &json!({
            "blocks": [
                { "type": "paragraph", "text": "Item", "listKind": "bullet" },
                {
                    "type": "image",
                    "text": "",
                    "dataUrl": "data:image/png;base64,cG5nLWJ5dGVz",
                    "width": 120,
                    "height": 80,
                    "altText": "Inserted"
                }
            ]
        }),
    )
    .expect("DOCX image should insert");

    let document = read_zip_text(&updated, "word/document.xml").unwrap();
    let rels = read_zip_text(&updated, "word/_rels/document.xml.rels").unwrap();
    let content_types = read_zip_text(&updated, "[Content_Types].xml").unwrap();
    let media = read_zip_bytes(&updated, "word/media/mymy-image-1.png").unwrap();

    assert_eq!(media, b"png-bytes");
    assert!(document.contains(r#"r:embed="rId1""#));
    assert!(document.contains(r#"descr="Inserted""#));
    assert!(rels.contains("relationships/image"));
    assert!(rels.contains(r#"Target="media/mymy-image-1.png""#));
    assert!(rels.contains("relationships/numbering"));
    assert!(content_types.contains(r#"Extension="png" ContentType="image/png""#));
    assert!(content_types.contains(r#"PartName="/word/numbering.xml""#));
}
