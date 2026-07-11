use super::*;

mod charts;
mod images;
mod shapes;
mod tables;
mod text;
mod timing;

pub(in crate::services::document_editor) use charts::*;
pub(in crate::services::document_editor) use images::*;
pub(in crate::services::document_editor) use shapes::*;
pub(in crate::services::document_editor) use tables::*;
pub(in crate::services::document_editor) use text::*;
pub(in crate::services::document_editor) use timing::*;

pub(in crate::services::document_editor) fn value_as_usize(value: Option<&Value>) -> Option<usize> {
    value
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
}

pub(in crate::services::document_editor) fn pptx_shape_id_from_model(
    value: &Value,
) -> Option<usize> {
    value
        .get("shapeId")
        .and_then(|shape_id| {
            shape_id
                .as_str()
                .and_then(|id| id.parse::<usize>().ok())
                .or_else(|| shape_id.as_u64().and_then(|id| usize::try_from(id).ok()))
        })
        .filter(|id| *id > 0)
}

pub(in crate::services::document_editor) fn pptx_group_shape_id_from_model(
    value: &Value,
) -> Option<usize> {
    value
        .get("groupShapeId")
        .and_then(|shape_id| {
            shape_id
                .as_str()
                .and_then(|id| id.parse::<usize>().ok())
                .or_else(|| shape_id.as_u64().and_then(|id| usize::try_from(id).ok()))
        })
        .filter(|id| *id > 0)
}

pub(in crate::services::document_editor) fn pptx_group_id_from_model(
    value: &Value,
) -> Option<String> {
    let group_id = value.get("groupId")?.as_str()?.trim();
    if !pptx_valid_group_id(group_id) {
        return None;
    }
    Some(group_id.to_string())
}
