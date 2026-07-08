use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub(super) struct ModelsListResponse {
    pub(super) data: Vec<ModelsListEntry>,
}

#[derive(Debug, Deserialize)]
pub(super) struct ModelsListEntry {
    pub(super) id: String,
}
