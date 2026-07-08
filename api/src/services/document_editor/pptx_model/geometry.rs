use super::{PptxShapeSpec, PptxSlideSize, PptxTextSpec};

pub(in crate::services::document_editor) fn pptx_geometry_emu_for_size(
    spec: &PptxTextSpec,
    slide_size: PptxSlideSize,
) -> (i64, i64, i64, i64) {
    pptx_percent_geometry_emu_for_size(spec.x, spec.y, spec.width, spec.height, slide_size)
}

pub(in crate::services::document_editor) fn pptx_shape_geometry_emu_for_size(
    spec: &PptxShapeSpec,
    slide_size: PptxSlideSize,
) -> (i64, i64, i64, i64) {
    pptx_percent_geometry_emu_for_size(spec.x, spec.y, spec.width, spec.height, slide_size)
}

pub(in crate::services::document_editor) fn pptx_percent_geometry_emu_for_size(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    slide_size: PptxSlideSize,
) -> (i64, i64, i64, i64) {
    let x = ((x.clamp(0.0, 100.0) / 100.0) * slide_size.width_emu).round() as i64;
    let y = ((y.clamp(0.0, 100.0) / 100.0) * slide_size.height_emu).round() as i64;
    let width = ((width.clamp(1.0, 100.0) / 100.0) * slide_size.width_emu)
        .round()
        .max(1.0) as i64;
    let height = ((height.clamp(1.0, 100.0) / 100.0) * slide_size.height_emu)
        .round()
        .max(1.0) as i64;
    (x, y, width, height)
}

pub(in crate::services::document_editor) fn pptx_rotation_unit(rotation: f64) -> i64 {
    (normalize_degrees(rotation) * 60_000.0).round() as i64
}

pub(in crate::services::document_editor) fn pptx_crop_unit(crop: f64) -> i64 {
    (crop.clamp(0.0, 95.0) * 1_000.0).round() as i64
}

pub(in crate::services::document_editor) fn normalize_degrees(value: f64) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }
    let normalized = value % 360.0;
    if normalized < 0.0 {
        normalized + 360.0
    } else {
        normalized
    }
}
