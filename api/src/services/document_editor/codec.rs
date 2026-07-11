//! Format codecs for document model v1.
//!
//! Codecs own only byte/model translation. They deliberately do not acquire
//! workspace locks, write files, create revision events, enqueue S3 work, or
//! choose HTTP errors. The document application service can therefore run one
//! save transaction around every format without letting a codec bypass the
//! common admission boundary.

use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::models::document_editor::DocumentEditorKind;

use super::{
    delimited_bytes, delimited_model, docx_model, pptx_model, text_bytes, text_model, update_docx,
    update_pptx, update_xlsx, xlsx_model,
};

pub(super) trait DocumentCodec: Sync {
    fn decode(&self, bytes: &[u8]) -> AppResult<Value>;
    fn encode(&self, original: &[u8], model: &Value) -> AppResult<Vec<u8>>;
}

struct TextCodec;
struct DelimitedCodec(char);
struct DocxCodec;
struct XlsxCodec;
struct PptxCodec;
struct PreviewCodec;

static TEXT: TextCodec = TextCodec;
static CSV: DelimitedCodec = DelimitedCodec(',');
static TSV: DelimitedCodec = DelimitedCodec('\t');
static DOCX: DocxCodec = DocxCodec;
static XLSX: XlsxCodec = XlsxCodec;
static PPTX: PptxCodec = PptxCodec;
static PREVIEW: PreviewCodec = PreviewCodec;

pub(super) fn codec_for_kind(kind: DocumentEditorKind) -> &'static dyn DocumentCodec {
    match kind {
        DocumentEditorKind::Markdown | DocumentEditorKind::Text => &TEXT,
        DocumentEditorKind::Csv => &CSV,
        DocumentEditorKind::Tsv => &TSV,
        DocumentEditorKind::Docx => &DOCX,
        DocumentEditorKind::Xlsx => &XLSX,
        DocumentEditorKind::Pptx => &PPTX,
        DocumentEditorKind::Preview => &PREVIEW,
    }
}

impl DocumentCodec for TextCodec {
    fn decode(&self, bytes: &[u8]) -> AppResult<Value> {
        text_model(bytes)
    }

    fn encode(&self, original: &[u8], model: &Value) -> AppResult<Vec<u8>> {
        text_bytes(original, model)
    }
}

impl DocumentCodec for DelimitedCodec {
    fn decode(&self, bytes: &[u8]) -> AppResult<Value> {
        delimited_model(bytes, self.0)
    }

    fn encode(&self, original: &[u8], model: &Value) -> AppResult<Vec<u8>> {
        delimited_bytes(original, model, self.0)
    }
}

macro_rules! office_codec {
    ($codec:ty, $decode:ident, $encode:ident) => {
        impl DocumentCodec for $codec {
            fn decode(&self, bytes: &[u8]) -> AppResult<Value> {
                $decode(bytes)
            }

            fn encode(&self, original: &[u8], model: &Value) -> AppResult<Vec<u8>> {
                if self.decode(original)? == *model {
                    // Producer-specific ordering, extension nodes, and ZIP
                    // metadata remain byte-for-byte stable for semantic no-op
                    // saves. A codec owns this preservation decision because
                    // it is format-specific, while persistence stays common.
                    return Ok(original.to_vec());
                }
                $encode(original, model)
            }
        }
    };
}

office_codec!(DocxCodec, docx_model, update_docx);
office_codec!(XlsxCodec, xlsx_model, update_xlsx);
office_codec!(PptxCodec, pptx_model, update_pptx);

impl DocumentCodec for PreviewCodec {
    fn decode(&self, _bytes: &[u8]) -> AppResult<Value> {
        Err(AppError::BadRequest("File type is not editable".into()))
    }

    fn encode(&self, _original: &[u8], _model: &Value) -> AppResult<Vec<u8>> {
        Err(AppError::BadRequest("File type is not editable".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_codec_round_trips_through_the_shared_interface() {
        let codec = codec_for_kind(DocumentEditorKind::Text);
        let model = codec.decode(b"alpha\n").unwrap();
        assert_eq!(codec.encode(b"alpha\n", &model).unwrap(), b"alpha\n");
    }
}
