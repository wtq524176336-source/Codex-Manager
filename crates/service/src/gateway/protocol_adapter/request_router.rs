use super::{AdaptedGatewayRequest, ResponseAdapter, ToolNameRestoreMap};

pub(crate) fn adapt_request_for_protocol(
    _protocol_type: &str,
    path: &str,
    body: Vec<u8>,
) -> Result<AdaptedGatewayRequest, String> {
    Ok(AdaptedGatewayRequest {
        path: path.to_string(),
        body,
        response_adapter: ResponseAdapter::Passthrough,
        tool_name_restore_map: ToolNameRestoreMap::new(),
    })
}
