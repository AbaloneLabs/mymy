use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub(super) struct AnthropicModelsResponse {
    pub(super) data: Vec<AnthropicModelEntry>,
}

#[derive(Debug, Deserialize)]
pub(super) struct AnthropicModelEntry {
    pub(super) id: String,
    #[serde(default)]
    pub(super) display_name: Option<String>,
}
