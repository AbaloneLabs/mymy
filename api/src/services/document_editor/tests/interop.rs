use std::fs;
use std::path::PathBuf;

use super::super::*;

/// This ignored lane consumes documents created by an external office suite,
/// applies one supported mymy edit, validates the resulting package, and emits
/// files for a second external open/export. The shell harness supplies paths so
/// ordinary unit tests never depend on LibreOffice being installed.
#[test]
#[ignore = "run through scripts/verify-document-editor-interop.sh"]
fn round_trip_external_office_fixtures() {
    let input =
        PathBuf::from(std::env::var("MYMY_INTEROP_INPUT").expect("MYMY_INTEROP_INPUT must be set"));
    let output = PathBuf::from(
        std::env::var("MYMY_INTEROP_OUTPUT").expect("MYMY_INTEROP_OUTPUT must be set"),
    );
    fs::create_dir_all(&output).unwrap();
    for (name, kind) in [
        ("writer.docx", DocumentEditorKind::Docx),
        ("calc.xlsx", DocumentEditorKind::Xlsx),
        ("impress.pptx", DocumentEditorKind::Pptx),
    ] {
        let source_path = input.join(name);
        let bytes = fs::read(&source_path)
            .unwrap_or_else(|error| panic!("failed to read {}: {error}", source_path.display()));
        let original_model = model_from_bytes(kind, &bytes).unwrap();
        assert_representative_external_fixture(kind, &original_model);
        let noop_bytes = bytes_from_model(kind, &bytes, &original_model).unwrap();
        let noop_path = output.join(format!("noop-{name}"));
        validate_saved_document_bytes(kind, &noop_path, &noop_bytes).unwrap();
        let reopened_noop = model_from_bytes(kind, &noop_bytes).unwrap();
        assert_eq!(
            reopened_noop, original_model,
            "save without a semantic edit changed the {kind:?} model"
        );
        fs::write(noop_path, noop_bytes).unwrap();

        let mut a_model = original_model.clone();
        apply_interop_edit(kind, &mut a_model);
        let (a_bytes, a_reopened) = save_interop_stage(kind, &bytes, &a_model, &output.join(name));
        assert_interop_edit(kind, &original_model, &a_model, &a_reopened);

        let mut ab_model = a_reopened.clone();
        apply_composed_interop_edit(kind, &mut ab_model);
        let (ab_bytes, ab_reopened) = save_interop_stage(
            kind,
            &a_bytes,
            &ab_model,
            &output.join(format!("ab-{name}")),
        );

        let mut inverse_b_model = ab_reopened;
        restore_composed_interop_edit(kind, &a_reopened, &mut inverse_b_model);
        let (inverse_b_bytes, inverse_b_reopened) = save_interop_stage(
            kind,
            &ab_bytes,
            &inverse_b_model,
            &output.join(format!("inverse-b-{name}")),
        );
        assert_interop_edit(kind, &original_model, &a_model, &inverse_b_reopened);

        let mut inverse_a_model = inverse_b_reopened;
        restore_interop_edit(kind, &original_model, &mut inverse_a_model);
        let (_, inverse_a_reopened) = save_interop_stage(
            kind,
            &inverse_b_bytes,
            &inverse_a_model,
            &output.join(format!("inverse-a-{name}")),
        );
        assert_interop_inverse(kind, &original_model, &inverse_a_reopened);
    }
}

fn assert_representative_external_fixture(kind: DocumentEditorKind, model: &Value) {
    match kind {
        DocumentEditorKind::Docx => {
            assert!(model["blocks"].as_array().is_some_and(|blocks| {
                blocks.iter().any(|block| {
                    block["runs"].as_array().is_some_and(|runs| runs.len() > 1)
                        && block["hyperlinks"]
                            .as_array()
                            .is_some_and(|links| !links.is_empty())
                })
            }));
        }
        DocumentEditorKind::Xlsx => {
            let sheet = &model["sheets"][0];
            assert!(!sheet["mergedRanges"].as_array().unwrap().is_empty());
            assert!(!sheet["dataValidations"].as_array().unwrap().is_empty());
            assert!(!sheet["hyperlinks"].as_array().unwrap().is_empty());
            assert_eq!(sheet["rows"][3]["cells"][1]["formula"], "SUM(B2:B3)");
            assert!(sheet["rows"][1]["cells"][2]["numberFormat"]
                .as_str()
                .is_some_and(|format| format.ends_with('%') && format.contains(".00")));
        }
        DocumentEditorKind::Pptx => {
            assert_eq!(model["slides"][0]["texts"][0]["complexText"], true);
            assert!(!model["slides"][0]["shapes"].as_array().unwrap().is_empty());
        }
        _ => unreachable!(),
    }
}

fn save_interop_stage(
    kind: DocumentEditorKind,
    original_bytes: &[u8],
    model: &Value,
    output_path: &std::path::Path,
) -> (Vec<u8>, Value) {
    let updated = bytes_from_model(kind, original_bytes, model).unwrap();
    validate_saved_document_bytes(kind, output_path, &updated).unwrap();
    let reopened = model_from_bytes(kind, &updated).unwrap();
    fs::write(output_path, &updated).unwrap();
    (updated, reopened)
}

fn apply_interop_edit(kind: DocumentEditorKind, model: &mut Value) {
    match kind {
        DocumentEditorKind::Docx => {
            let block = model["blocks"]
                .as_array_mut()
                .and_then(|blocks| {
                    blocks.iter_mut().find(|block| {
                        matches!(
                            block.get("type").and_then(Value::as_str),
                            Some("paragraph" | "heading")
                        ) && block
                            .get("fields")
                            .and_then(Value::as_array)
                            .is_none_or(Vec::is_empty)
                            && block
                                .get("contentControls")
                                .and_then(Value::as_array)
                                .is_none_or(Vec::is_empty)
                    })
                })
                .expect("writer fixture needs one editable paragraph");
            let text = block["text"].as_str().unwrap_or_default();
            block["text"] = json!(format!("{text} · mymy ✓"));
            block.as_object_mut().unwrap().remove("runs");
        }
        DocumentEditorKind::Xlsx => {
            let cell = &mut model["sheets"][0]["rows"][1]["cells"][1];
            cell["value"] = json!("42");
            cell.as_object_mut().unwrap().remove("formula");
        }
        DocumentEditorKind::Pptx => {
            let text = &mut model["slides"][0]["texts"][0];
            let x = text["x"]
                .as_f64()
                .expect("presentation text needs geometry");
            text["x"] = json!(x + 1.25);
        }
        _ => unreachable!(),
    }
}

fn apply_composed_interop_edit(kind: DocumentEditorKind, model: &mut Value) {
    match kind {
        DocumentEditorKind::Docx => {
            let margin = model["page"]["marginTop"].as_u64().unwrap_or(1_440);
            model["page"]["marginTop"] = json!(margin + 120);
        }
        DocumentEditorKind::Xlsx => {
            let cell = &mut model["sheets"][0]["rows"][2]["cells"][1];
            cell["value"] = json!("29");
            cell.as_object_mut().unwrap().remove("formula");
        }
        DocumentEditorKind::Pptx => {
            let text = &mut model["slides"][0]["texts"][0];
            let y = text["y"]
                .as_f64()
                .expect("presentation text needs geometry");
            text["y"] = json!(y + 1.25);
        }
        _ => unreachable!(),
    }
}

fn restore_composed_interop_edit(kind: DocumentEditorKind, after_a: &Value, model: &mut Value) {
    match kind {
        DocumentEditorKind::Docx => model["page"] = after_a["page"].clone(),
        DocumentEditorKind::Xlsx => {
            model["sheets"][0]["rows"][2]["cells"][1] =
                after_a["sheets"][0]["rows"][2]["cells"][1].clone();
        }
        DocumentEditorKind::Pptx => {
            model["slides"][0]["texts"][0]["y"] = after_a["slides"][0]["texts"][0]["y"].clone();
        }
        _ => unreachable!(),
    }
}

fn restore_interop_edit(kind: DocumentEditorKind, original: &Value, model: &mut Value) {
    match kind {
        DocumentEditorKind::Docx => {
            let edited_index = model["blocks"]
                .as_array()
                .and_then(|blocks| {
                    blocks.iter().position(|block| {
                        block["text"]
                            .as_str()
                            .is_some_and(|text| text.ends_with(" · mymy ✓"))
                    })
                })
                .unwrap();
            model["blocks"][edited_index] = original["blocks"][edited_index].clone();
        }
        DocumentEditorKind::Xlsx => {
            model["sheets"][0]["rows"][1]["cells"][1] =
                original["sheets"][0]["rows"][1]["cells"][1].clone();
        }
        DocumentEditorKind::Pptx => {
            model["slides"][0]["texts"][0]["x"] = original["slides"][0]["texts"][0]["x"].clone();
        }
        _ => unreachable!(),
    }
}

fn assert_interop_edit(
    kind: DocumentEditorKind,
    original: &Value,
    edited: &Value,
    reopened: &Value,
) {
    match kind {
        DocumentEditorKind::Docx => {
            let edited_blocks = edited["blocks"].as_array().unwrap();
            let reopened_blocks = reopened["blocks"].as_array().unwrap();
            let edited_index = edited_blocks
                .iter()
                .position(|block| {
                    block["text"]
                        .as_str()
                        .is_some_and(|text| text.ends_with(" · mymy ✓"))
                })
                .expect("edited paragraph should carry the interoperability marker");
            assert_eq!(
                reopened_blocks[edited_index]["text"], edited_blocks[edited_index]["text"],
                "Writer did not preserve the supported paragraph edit"
            );
            for index in 0..edited_blocks.len() {
                if index != edited_index {
                    assert_eq!(
                        reopened_blocks[index], original["blocks"][index],
                        "an unrelated Writer block changed at index {index}"
                    );
                }
            }
        }
        DocumentEditorKind::Xlsx => {
            assert_eq!(
                reopened["sheets"][0]["rows"][1]["cells"][1]["value"],
                edited["sheets"][0]["rows"][1]["cells"][1]["value"],
                "Calc did not preserve the supported cell edit"
            );
            assert_eq!(
                reopened["sheets"][0]["rows"][0], original["sheets"][0]["rows"][0],
                "the spreadsheet header changed while editing another cell"
            );
            assert_eq!(
                reopened["sheets"][0]["rows"][2], original["sheets"][0]["rows"][2],
                "an unrelated spreadsheet row changed"
            );
        }
        DocumentEditorKind::Pptx => {
            let original_text = &original["slides"][0]["texts"][0];
            let reopened_text = &reopened["slides"][0]["texts"][0];
            let expected_x = edited["slides"][0]["texts"][0]["x"].as_f64().unwrap();
            let actual_x = reopened_text["x"].as_f64().unwrap();
            assert!(
                (actual_x - expected_x).abs() < 0.000_01,
                "Impress did not preserve the supported geometry edit: expected {expected_x}, got {actual_x}"
            );
            assert_eq!(
                reopened_text["text"], original_text["text"],
                "moving a presentation object changed its rich text"
            );
            assert_eq!(
                reopened_text["complexText"], original_text["complexText"],
                "moving a presentation object changed its preservation mode"
            );
            assert_eq!(
                reopened["slides"][0]["shapes"], original["slides"][0]["shapes"],
                "moving presentation text changed an adjacent shape"
            );
        }
        _ => unreachable!(),
    }
}

fn assert_interop_inverse(kind: DocumentEditorKind, original: &Value, reopened: &Value) {
    match kind {
        DocumentEditorKind::Docx => {
            assert_eq!(reopened["blocks"], original["blocks"]);
            assert_eq!(reopened["page"], original["page"]);
        }
        DocumentEditorKind::Xlsx => {
            assert_eq!(reopened["sheets"], original["sheets"]);
        }
        DocumentEditorKind::Pptx => {
            let original_text = &original["slides"][0]["texts"][0];
            let reopened_text = &reopened["slides"][0]["texts"][0];
            for axis in ["x", "y"] {
                let expected = original_text[axis].as_f64().unwrap();
                let actual = reopened_text[axis].as_f64().unwrap();
                assert!(
                    (actual - expected).abs() < 0.000_01,
                    "presentation inverse changed {axis}: expected {expected}, got {actual}"
                );
            }
            assert_eq!(reopened_text["text"], original_text["text"]);
            assert_eq!(reopened_text["complexText"], original_text["complexText"]);
            assert_eq!(
                reopened["slides"][0]["shapes"],
                original["slides"][0]["shapes"]
            );
        }
        _ => unreachable!(),
    }
}
