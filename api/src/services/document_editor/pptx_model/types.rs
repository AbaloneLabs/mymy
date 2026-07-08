use super::super::ooxml_charts::OoxmlChartSeriesSpec;

#[derive(Debug, Clone)]
pub(in crate::services::document_editor) struct PptxTextSpec {
    pub(in crate::services::document_editor) text: String,
    pub(in crate::services::document_editor) text_index: Option<usize>,
    pub(in crate::services::document_editor) group_id: Option<String>,
    pub(in crate::services::document_editor) x: f64,
    pub(in crate::services::document_editor) y: f64,
    pub(in crate::services::document_editor) width: f64,
    pub(in crate::services::document_editor) height: f64,
    pub(in crate::services::document_editor) rotation: f64,
    pub(in crate::services::document_editor) font_size: u32,
    pub(in crate::services::document_editor) font_family: Option<String>,
    pub(in crate::services::document_editor) color: Option<String>,
    pub(in crate::services::document_editor) fill_color: Option<String>,
    pub(in crate::services::document_editor) bold: bool,
    pub(in crate::services::document_editor) italic: bool,
    pub(in crate::services::document_editor) underline: bool,
    pub(in crate::services::document_editor) strikethrough: bool,
    pub(in crate::services::document_editor) align: Option<String>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(in crate::services::document_editor) enum PptxShapeKind {
    Rect,
    RoundRect,
    Ellipse,
    Line,
    StraightConnector1,
    Triangle,
    Diamond,
    Parallelogram,
    Trapezoid,
    Pentagon,
    Hexagon,
    RightArrow,
    LeftArrow,
    UpArrow,
    DownArrow,
    LeftRightArrow,
    Star5,
    Heart,
    Cloud,
}

impl PptxShapeKind {
    pub(in crate::services::document_editor) fn from_value(value: &str) -> Option<Self> {
        match value {
            "rect" => Some(Self::Rect),
            "roundRect" => Some(Self::RoundRect),
            "ellipse" => Some(Self::Ellipse),
            "line" => Some(Self::Line),
            "straightConnector1" => Some(Self::StraightConnector1),
            "triangle" => Some(Self::Triangle),
            "diamond" => Some(Self::Diamond),
            "parallelogram" => Some(Self::Parallelogram),
            "trapezoid" => Some(Self::Trapezoid),
            "pentagon" => Some(Self::Pentagon),
            "hexagon" => Some(Self::Hexagon),
            "rightArrow" => Some(Self::RightArrow),
            "leftArrow" => Some(Self::LeftArrow),
            "upArrow" => Some(Self::UpArrow),
            "downArrow" => Some(Self::DownArrow),
            "leftRightArrow" => Some(Self::LeftRightArrow),
            "star5" => Some(Self::Star5),
            "heart" => Some(Self::Heart),
            "cloud" => Some(Self::Cloud),
            _ => None,
        }
    }

    pub(in crate::services::document_editor) fn as_value(self) -> &'static str {
        match self {
            Self::Rect => "rect",
            Self::RoundRect => "roundRect",
            Self::Ellipse => "ellipse",
            Self::Line => "line",
            Self::StraightConnector1 => "straightConnector1",
            Self::Triangle => "triangle",
            Self::Diamond => "diamond",
            Self::Parallelogram => "parallelogram",
            Self::Trapezoid => "trapezoid",
            Self::Pentagon => "pentagon",
            Self::Hexagon => "hexagon",
            Self::RightArrow => "rightArrow",
            Self::LeftArrow => "leftArrow",
            Self::UpArrow => "upArrow",
            Self::DownArrow => "downArrow",
            Self::LeftRightArrow => "leftRightArrow",
            Self::Star5 => "star5",
            Self::Heart => "heart",
            Self::Cloud => "cloud",
        }
    }

    pub(in crate::services::document_editor) fn is_line_like(self) -> bool {
        matches!(self, Self::Line | Self::StraightConnector1)
    }

    pub(in crate::services::document_editor) fn is_connector(self) -> bool {
        matches!(self, Self::StraightConnector1)
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(in crate::services::document_editor) enum PptxLineArrowKind {
    Triangle,
    Stealth,
    Diamond,
    Oval,
}

impl PptxLineArrowKind {
    pub(in crate::services::document_editor) fn from_value(value: &str) -> Option<Self> {
        match value {
            "triangle" => Some(Self::Triangle),
            "stealth" => Some(Self::Stealth),
            "diamond" => Some(Self::Diamond),
            "oval" => Some(Self::Oval),
            _ => None,
        }
    }

    pub(in crate::services::document_editor) fn as_value(self) -> &'static str {
        match self {
            Self::Triangle => "triangle",
            Self::Stealth => "stealth",
            Self::Diamond => "diamond",
            Self::Oval => "oval",
        }
    }
}

#[derive(Debug, Clone)]
pub(in crate::services::document_editor) struct PptxShapeSpec {
    pub(in crate::services::document_editor) kind: PptxShapeKind,
    pub(in crate::services::document_editor) group_id: Option<String>,
    pub(in crate::services::document_editor) x: f64,
    pub(in crate::services::document_editor) y: f64,
    pub(in crate::services::document_editor) width: f64,
    pub(in crate::services::document_editor) height: f64,
    pub(in crate::services::document_editor) rotation: f64,
    pub(in crate::services::document_editor) fill_color: Option<String>,
    pub(in crate::services::document_editor) stroke_color: Option<String>,
    pub(in crate::services::document_editor) stroke_width: f64,
    pub(in crate::services::document_editor) line_start_arrow: Option<PptxLineArrowKind>,
    pub(in crate::services::document_editor) line_end_arrow: Option<PptxLineArrowKind>,
}

#[derive(Debug, Clone)]
pub(in crate::services::document_editor) struct PptxTableSpec {
    pub(in crate::services::document_editor) text_index_start: Option<usize>,
    pub(in crate::services::document_editor) group_id: Option<String>,
    pub(in crate::services::document_editor) rows: Vec<Vec<String>>,
    pub(in crate::services::document_editor) cell_styles: Vec<Vec<PptxTableCellStyle>>,
    pub(in crate::services::document_editor) column_widths: Vec<f64>,
    pub(in crate::services::document_editor) row_heights: Vec<f64>,
    pub(in crate::services::document_editor) x: f64,
    pub(in crate::services::document_editor) y: f64,
    pub(in crate::services::document_editor) width: f64,
    pub(in crate::services::document_editor) height: f64,
    pub(in crate::services::document_editor) rotation: f64,
    pub(in crate::services::document_editor) table_style_id: Option<String>,
    pub(in crate::services::document_editor) first_row: bool,
    pub(in crate::services::document_editor) first_column: bool,
    pub(in crate::services::document_editor) last_row: bool,
    pub(in crate::services::document_editor) last_column: bool,
    pub(in crate::services::document_editor) banded_rows: bool,
    pub(in crate::services::document_editor) banded_columns: bool,
}

#[derive(Debug, Clone, Default)]
pub(in crate::services::document_editor) struct PptxTableCellStyle {
    pub(in crate::services::document_editor) fill_color: Option<String>,
    pub(in crate::services::document_editor) text_color: Option<String>,
    pub(in crate::services::document_editor) bold: Option<bool>,
    pub(in crate::services::document_editor) italic: Option<bool>,
    pub(in crate::services::document_editor) align: Option<String>,
}

#[derive(Debug, Clone)]
pub(in crate::services::document_editor) struct PptxImageSpec {
    pub(in crate::services::document_editor) relationship_id: Option<String>,
    pub(in crate::services::document_editor) data_url: Option<String>,
    pub(in crate::services::document_editor) group_id: Option<String>,
    pub(in crate::services::document_editor) x: f64,
    pub(in crate::services::document_editor) y: f64,
    pub(in crate::services::document_editor) width: f64,
    pub(in crate::services::document_editor) height: f64,
    pub(in crate::services::document_editor) rotation: f64,
    pub(in crate::services::document_editor) crop_left: f64,
    pub(in crate::services::document_editor) crop_top: f64,
    pub(in crate::services::document_editor) crop_right: f64,
    pub(in crate::services::document_editor) crop_bottom: f64,
    pub(in crate::services::document_editor) alt_text: Option<String>,
}

#[derive(Debug, Clone)]
pub(in crate::services::document_editor) struct PptxChartSpec {
    pub(in crate::services::document_editor) relationship_id: Option<String>,
    pub(in crate::services::document_editor) path: Option<String>,
    pub(in crate::services::document_editor) group_id: Option<String>,
    pub(in crate::services::document_editor) chart_type: Option<String>,
    pub(in crate::services::document_editor) title: Option<String>,
    pub(in crate::services::document_editor) legend_visible: Option<bool>,
    pub(in crate::services::document_editor) legend_position: Option<String>,
    pub(in crate::services::document_editor) category_axis: PptxChartAxisSpec,
    pub(in crate::services::document_editor) value_axis: PptxChartAxisSpec,
    pub(in crate::services::document_editor) series: Vec<OoxmlChartSeriesSpec>,
    pub(in crate::services::document_editor) x: f64,
    pub(in crate::services::document_editor) y: f64,
    pub(in crate::services::document_editor) width: f64,
    pub(in crate::services::document_editor) height: f64,
    pub(in crate::services::document_editor) rotation: f64,
}

#[derive(Debug, Clone, Default)]
pub(in crate::services::document_editor) struct PptxChartAxisSpec {
    pub(in crate::services::document_editor) title: Option<String>,
    pub(in crate::services::document_editor) position: Option<String>,
    pub(in crate::services::document_editor) major_gridlines: Option<bool>,
    pub(in crate::services::document_editor) tick_label_position: Option<String>,
    pub(in crate::services::document_editor) major_tick_mark: Option<String>,
    pub(in crate::services::document_editor) minor_tick_mark: Option<String>,
    pub(in crate::services::document_editor) number_format: Option<String>,
    pub(in crate::services::document_editor) line_color: Option<String>,
    pub(in crate::services::document_editor) line_width: Option<f64>,
    pub(in crate::services::document_editor) line_dash: Option<String>,
    pub(in crate::services::document_editor) label_text_color: Option<String>,
    pub(in crate::services::document_editor) label_font_size: Option<u32>,
    pub(in crate::services::document_editor) label_rotation: Option<f64>,
    pub(in crate::services::document_editor) label_bold: Option<bool>,
    pub(in crate::services::document_editor) label_italic: Option<bool>,
}

#[derive(Debug, Clone)]
pub(in crate::services::document_editor) struct PptxMediaSpec {
    pub(in crate::services::document_editor) timing_index: Option<usize>,
    pub(in crate::services::document_editor) volume_percent: Option<f64>,
    pub(in crate::services::document_editor) muted: Option<bool>,
    pub(in crate::services::document_editor) show_when_stopped: Option<bool>,
    pub(in crate::services::document_editor) delay_ms: Option<u32>,
    pub(in crate::services::document_editor) duration_ms: Option<u32>,
}

#[derive(Debug, Clone)]
pub(in crate::services::document_editor) struct PptxTransitionSpec {
    pub(in crate::services::document_editor) kind: String,
    pub(in crate::services::document_editor) speed: Option<String>,
    pub(in crate::services::document_editor) direction: Option<String>,
    pub(in crate::services::document_editor) advance_on_click: bool,
    pub(in crate::services::document_editor) advance_after_ms: Option<u32>,
}

#[derive(Debug, Clone)]
pub(in crate::services::document_editor) struct PptxAnimationSpec {
    pub(in crate::services::document_editor) source_xml: Option<String>,
    pub(in crate::services::document_editor) delay_ms: Option<u32>,
    pub(in crate::services::document_editor) duration_ms: Option<u32>,
}

#[derive(Debug, Clone)]
pub(in crate::services::document_editor) enum PptxBackgroundSpec {
    Solid(String),
    Gradient {
        start_color: String,
        end_color: String,
        angle: f64,
    },
    Image {
        relationship_id: String,
    },
}

#[derive(Debug, Clone, Copy)]
pub(in crate::services::document_editor) struct PptxObjectBounds {
    pub(in crate::services::document_editor) x: i64,
    pub(in crate::services::document_editor) y: i64,
    pub(in crate::services::document_editor) width: i64,
    pub(in crate::services::document_editor) height: i64,
}

#[derive(Debug, Clone)]
pub(in crate::services::document_editor) struct PptxRenderableObject {
    pub(in crate::services::document_editor) group_id: Option<String>,
    pub(in crate::services::document_editor) bounds: PptxObjectBounds,
    pub(in crate::services::document_editor) xml: String,
}

#[derive(Debug, Clone)]
pub(in crate::services::document_editor) struct PptxGroupContext {
    pub(in crate::services::document_editor) start: usize,
    pub(in crate::services::document_editor) end: usize,
    pub(in crate::services::document_editor) group_id: String,
}
