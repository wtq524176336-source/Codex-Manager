use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ResponseAdapter {
    Passthrough,
    ChatCompletionsFromResponses,
    ImagesB64JsonFromResponses,
    ImagesUrlFromResponses,
}

pub(crate) type ToolNameRestoreMap = BTreeMap<String, String>;
