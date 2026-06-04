pub(super) fn maybe_respond_local_count_tokens(
    request: tiny_http::Request,
    _trace_id: &str,
    _key_id: &str,
    _protocol_type: &str,
    _original_path: &str,
    _path: &str,
    _response_adapter: super::ResponseAdapter,
    _request_method: &str,
    _body: &[u8],
    _model_for_log: Option<&str>,
    _reasoning_for_log: Option<&str>,
    _storage: &codexmanager_core::storage::Storage,
) -> Result<Option<tiny_http::Request>, String> {
    Ok(Some(request))
}
