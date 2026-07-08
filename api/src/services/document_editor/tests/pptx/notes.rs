use super::super::super::*;
use super::super::common::*;

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
