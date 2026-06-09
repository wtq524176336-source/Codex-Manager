use bytes::Bytes;
use codexmanager_core::storage::Account;
use futures_util::StreamExt;
use std::sync::mpsc;
use std::thread;
use std::time::Instant;
use tiny_http::Request;
use tokio::runtime::Builder;

use super::super::GatewayUpstreamResponse;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RequestCompression {
    None,
    Zstd,
}

#[derive(Debug, Clone, Copy)]
pub(in super::super) struct UpstreamRequestContext<'a> {
    pub(in super::super) request_path: &'a str,
    pub(in super::super) transparent_mode: bool,
}

impl<'a> UpstreamRequestContext<'a> {
    /// 函数 `from_request`
    ///
    /// 作者: gaohongshun
    ///
    /// 时间: 2026-04-02
    ///
    /// # 参数
    /// - in super: 参数 in super
    ///
    /// # 返回
    /// 返回函数执行结果
    pub(in super::super) fn from_request(request: &'a Request, transparent_mode: bool) -> Self {
        Self {
            request_path: request.url(),
            transparent_mode,
        }
    }
}

/// 函数 `should_force_connection_close`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - target_url: 参数 target_url
///
/// # 返回
/// 返回函数执行结果
fn should_force_connection_close(target_url: &str) -> bool {
    reqwest::Url::parse(target_url)
        .ok()
        .and_then(|url| url.host_str().map(|host| host.to_ascii_lowercase()))
        .is_some_and(|host| matches!(host.as_str(), "127.0.0.1" | "localhost" | "::1"))
}

/// 函数 `force_connection_close`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - headers: 参数 headers
///
/// # 返回
/// 无
fn force_connection_close(headers: &mut Vec<(String, String)>) {
    if let Some((_, value)) = headers
        .iter_mut()
        .find(|(name, _)| name.eq_ignore_ascii_case("connection"))
    {
        *value = "close".to_string();
    } else {
        headers.push(("Connection".to_string(), "close".to_string()));
    }
}

/// 函数 `extract_prompt_cache_key`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - body: 参数 body
///
/// # 返回
/// 返回函数执行结果
fn extract_prompt_cache_key(body: &[u8]) -> Option<String> {
    if body.is_empty() || body.len() > 64 * 1024 {
        return None;
    }
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(body) else {
        return None;
    };
    value
        .get("prompt_cache_key")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

fn strip_compact_service_tier_for_transport(body: &Bytes, preserve_service_tier: bool) -> Bytes {
    if preserve_service_tier || body.is_empty() {
        return body.clone();
    }
    let Ok(mut value) = serde_json::from_slice::<serde_json::Value>(body) else {
        return body.clone();
    };
    let Some(object) = value.as_object_mut() else {
        return body.clone();
    };
    if object.remove("service_tier").is_none() {
        return body.clone();
    }
    serde_json::to_vec(&value)
        .map(Bytes::from)
        .unwrap_or_else(|_| body.clone())
}

/// 函数 `is_compact_request_path`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - path: 参数 path
///
/// # 返回
/// 返回函数执行结果
fn is_compact_request_path(path: &str) -> bool {
    path == "/v1/responses/compact" || path.starts_with("/v1/responses/compact?")
}

/// 函数 `has_header`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - headers: 参数 headers
/// - name: 参数 name
///
/// # 返回
/// 返回函数执行结果
fn has_header(headers: &[(String, String)], name: &str) -> bool {
    headers
        .iter()
        .any(|(header_name, _)| header_name.eq_ignore_ascii_case(name))
}

/// 函数 `resolve_chatgpt_account_header`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - account: 参数 account
/// - target_url: 参数 target_url
///
/// # 返回
/// 返回函数执行结果
fn resolve_chatgpt_account_header<'a>(account: &'a Account, target_url: &str) -> Option<&'a str> {
    if !super::super::config::should_send_chatgpt_account_header(target_url) {
        return None;
    }
    account
        .chatgpt_account_id
        .as_deref()
        .or(account.workspace_id.as_deref())
}

fn build_transparent_upstream_headers(
    incoming_headers: &super::super::super::IncomingHeaderSnapshot,
    auth_token: &str,
    chatgpt_account_header: Option<&str>,
) -> Vec<(String, String)> {
    incoming_headers.transparent_upstream_headers(auth_token, chatgpt_account_header)
}

/// 函数 `resolve_request_compression_with_flag`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - enabled: 参数 enabled
/// - target_url: 参数 target_url
/// - request_path: 参数 request_path
/// - is_stream: 参数 is_stream
///
/// # 返回
/// 返回函数执行结果
fn resolve_request_compression_with_flag(
    enabled: bool,
    target_url: &str,
    request_path: &str,
    is_stream: bool,
) -> RequestCompression {
    if !enabled {
        return RequestCompression::None;
    }
    if !is_stream {
        return RequestCompression::None;
    }
    if is_compact_request_path(request_path) || !request_path.starts_with("/v1/responses") {
        return RequestCompression::None;
    }
    if !super::super::config::is_chatgpt_backend_base(target_url) {
        return RequestCompression::None;
    }
    RequestCompression::Zstd
}

/// 函数 `resolve_request_compression`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - target_url: 参数 target_url
/// - request_path: 参数 request_path
/// - is_stream: 参数 is_stream
///
/// # 返回
/// 返回函数执行结果
fn resolve_request_compression(
    target_url: &str,
    request_path: &str,
    is_stream: bool,
) -> RequestCompression {
    resolve_request_compression_with_flag(
        super::super::super::request_compression_enabled(),
        target_url,
        request_path,
        is_stream,
    )
}

fn should_retry_transport_without_compression(
    target_url: &str,
    request_path: &str,
    is_stream: bool,
    compression: RequestCompression,
) -> bool {
    compression == RequestCompression::Zstd
        && is_stream
        && request_path.starts_with("/v1/responses")
        && !is_compact_request_path(request_path)
        && super::super::config::is_chatgpt_backend_base(target_url)
}

fn should_wrap_upstream_as_stream_response(request_path: &str, is_stream: bool) -> bool {
    is_stream && request_path.starts_with("/v1/responses") && !is_compact_request_path(request_path)
}

fn send_async_stream_request(
    client: &reqwest::Client,
    method: &reqwest::Method,
    target_url: &str,
    request_deadline: Option<Instant>,
    request_headers: &[(String, String)],
    request_body: &Bytes,
    is_stream: bool,
) -> Result<super::super::GatewayStreamResponse, reqwest::Error> {
    let client = client.clone();
    let method = method.clone();
    let target_url = target_url.to_string();
    let request_headers = request_headers.to_vec();
    let request_body = request_body.clone();
    let (meta_tx, meta_rx) = mpsc::sync_channel::<
        Result<(reqwest::StatusCode, reqwest::header::HeaderMap), reqwest::Error>,
    >(1);
    let (body_tx, body_rx) = mpsc::sync_channel::<super::super::GatewayByteStreamItem>(128);
    thread::spawn(move || {
        let runtime = Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap_or_else(|err| panic!("build gateway upstream runtime failed: {err}"));
        runtime.block_on(async move {
            let mut builder = client.request(method, target_url);
            if let Some(timeout) =
                super::super::support::deadline::send_timeout(request_deadline, is_stream)
            {
                builder = builder.timeout(timeout);
            }
            for (name, value) in request_headers.iter() {
                builder = builder.header(name, value);
            }
            if !request_body.is_empty() {
                builder = builder.body(request_body);
            }
            match builder.send().await {
                Ok(response) => {
                    let status = response.status();
                    let headers = response.headers().clone();
                    if meta_tx.send(Ok((status, headers))).is_err() {
                        return;
                    }
                    let mut stream = response.bytes_stream();
                    while let Some(item) = stream.next().await {
                        match item {
                            Ok(bytes) => {
                                if body_tx
                                    .send(super::super::GatewayByteStreamItem::Chunk(bytes))
                                    .is_err()
                                {
                                    return;
                                }
                            }
                            Err(err) => {
                                let _ = body_tx.send(super::super::GatewayByteStreamItem::Error(
                                    err.to_string(),
                                ));
                                return;
                            }
                        }
                    }
                    let _ = body_tx.send(super::super::GatewayByteStreamItem::Eof);
                }
                Err(err) => {
                    let _ = meta_tx.send(Err(err));
                }
            }
        });
    });
    match meta_rx.recv() {
        Ok(Ok((status, headers))) => Ok(super::super::GatewayStreamResponse::new(
            status,
            headers,
            super::super::GatewayByteStream::from_receiver(body_rx),
        )),
        Ok(Err(err)) => Err(err),
        Err(_) => panic!("receive gateway async upstream response metadata failed"),
    }
}

/// 函数 `encode_request_body`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - request_path: 参数 request_path
/// - body: 参数 body
/// - compression: 参数 compression
/// - headers: 参数 headers
///
/// # 返回
/// 返回函数执行结果
fn encode_request_body(
    request_path: &str,
    body: &Bytes,
    compression: RequestCompression,
    headers: &mut Vec<(String, String)>,
) -> Bytes {
    if body.is_empty() || compression == RequestCompression::None {
        return body.clone();
    }
    if has_header(headers, "Content-Encoding") {
        log::warn!(
            "event=gateway_request_compression_skipped reason=content_encoding_exists path={}",
            request_path
        );
        return body.clone();
    }
    match compression {
        RequestCompression::None => body.clone(),
        RequestCompression::Zstd => {
            match zstd::stream::encode_all(std::io::Cursor::new(body.as_ref()), 3) {
                Ok(compressed) => {
                    let post_bytes = compressed.len();
                    headers.push(("Content-Encoding".to_string(), "zstd".to_string()));
                    log::info!(
                    "event=gateway_request_compressed path={} algorithm=zstd pre_bytes={} post_bytes={}",
                    request_path,
                    body.len(),
                    post_bytes
                );
                    Bytes::from(compressed)
                }
                Err(err) => {
                    log::warn!(
                        "event=gateway_request_compression_failed path={} algorithm=zstd err={}",
                        request_path,
                        err
                    );
                    body.clone()
                }
            }
        }
    }
}

/// 函数 `send_upstream_request`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - in super: 参数 in super
///
/// # 返回
/// 返回函数执行结果
pub(in super::super) fn send_upstream_request(
    client: &reqwest::blocking::Client,
    method: &reqwest::Method,
    target_url: &str,
    request_deadline: Option<Instant>,
    request_ctx: UpstreamRequestContext<'_>,
    incoming_headers: &super::super::super::IncomingHeaderSnapshot,
    body: &Bytes,
    is_stream: bool,
    auth_token: &str,
    account: &Account,
    strip_session_affinity: bool,
) -> Result<GatewayUpstreamResponse, reqwest::Error> {
    send_upstream_request_with_compression_override(
        client,
        method,
        target_url,
        request_deadline,
        request_ctx,
        incoming_headers,
        body,
        is_stream,
        auth_token,
        account,
        strip_session_affinity,
        None,
    )
}

/// 函数 `send_upstream_request_without_compression`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-04
///
/// # 参数
/// - in super: 参数 in super
///
/// # 返回
/// 返回函数执行结果
pub(in super::super) fn send_upstream_request_without_compression(
    client: &reqwest::blocking::Client,
    method: &reqwest::Method,
    target_url: &str,
    request_deadline: Option<Instant>,
    request_ctx: UpstreamRequestContext<'_>,
    incoming_headers: &super::super::super::IncomingHeaderSnapshot,
    body: &Bytes,
    is_stream: bool,
    auth_token: &str,
    account: &Account,
    strip_session_affinity: bool,
) -> Result<GatewayUpstreamResponse, reqwest::Error> {
    send_upstream_request_with_compression_override(
        client,
        method,
        target_url,
        request_deadline,
        request_ctx,
        incoming_headers,
        body,
        is_stream,
        auth_token,
        account,
        strip_session_affinity,
        Some(RequestCompression::None),
    )
}

/// 函数 `send_upstream_request_with_compression_override`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-04
///
/// # 参数
/// - compression_override: 参数 compression_override
///
/// # 返回
/// 返回函数执行结果
fn send_upstream_request_with_compression_override(
    client: &reqwest::blocking::Client,
    method: &reqwest::Method,
    target_url: &str,
    request_deadline: Option<Instant>,
    request_ctx: UpstreamRequestContext<'_>,
    incoming_headers: &super::super::super::IncomingHeaderSnapshot,
    body: &Bytes,
    is_stream: bool,
    auth_token: &str,
    account: &Account,
    strip_session_affinity: bool,
    compression_override: Option<RequestCompression>,
) -> Result<GatewayUpstreamResponse, reqwest::Error> {
    let attempt_started_at = Instant::now();
    let is_compact_request = is_compact_request_path(request_ctx.request_path);
    let chatgpt_account_header = resolve_chatgpt_account_header(account, target_url);
    let body_for_transport = if request_ctx.transparent_mode {
        body.clone()
    } else if is_compact_request {
        strip_compact_service_tier_for_transport(body, chatgpt_account_header.is_some())
    } else {
        body.clone()
    };
    let prompt_cache_key = extract_prompt_cache_key(body_for_transport.as_ref());
    let request_affinity = super::super::super::session_affinity::derive_outgoing_session_affinity(
        incoming_headers.session_id(),
        incoming_headers.client_request_id(),
        incoming_headers.turn_state(),
        incoming_headers.conversation_id(),
        prompt_cache_key.as_deref(),
    );
    let account_id = account
        .chatgpt_account_id
        .as_deref()
        .or_else(|| account.workspace_id.as_deref());
    super::super::super::session_affinity::log_thread_anchor_conflict(
        request_ctx.request_path,
        account_id,
        incoming_headers.conversation_id(),
        prompt_cache_key.as_deref(),
    );
    super::super::super::session_affinity::log_outgoing_session_affinity(
        request_ctx.request_path,
        account_id,
        incoming_headers.session_id(),
        incoming_headers.client_request_id(),
        incoming_headers.turn_state(),
        incoming_headers.conversation_id(),
        prompt_cache_key.as_deref(),
        request_affinity,
        strip_session_affinity,
    );
    let mut upstream_headers = if request_ctx.transparent_mode {
        build_transparent_upstream_headers(incoming_headers, auth_token, chatgpt_account_header)
    } else if is_compact_request {
        let installation_id = super::super::header_profile::resolve_codex_installation_id(
            incoming_headers.codex_installation_id(),
        );
        let header_input = super::super::header_profile::CodexCompactUpstreamHeaderInput {
            auth_token,
            chatgpt_account_id: chatgpt_account_header,
            installation_id: installation_id.as_deref(),
            incoming_user_agent: incoming_headers.user_agent(),
            incoming_originator: incoming_headers.originator(),
            incoming_session_id: request_affinity.incoming_session_id,
            thread_id: request_affinity.fallback_session_id,
            incoming_window_id: incoming_headers.window_id(),
            incoming_subagent: incoming_headers.subagent(),
            incoming_parent_thread_id: incoming_headers.parent_thread_id(),
            passthrough_codex_headers: incoming_headers.passthrough_codex_headers(),
            fallback_session_id: request_affinity.fallback_session_id,
            strip_session_affinity,
            has_body: !body_for_transport.is_empty(),
        };
        super::super::header_profile::build_codex_compact_upstream_headers(header_input)
    } else {
        let header_input = super::super::header_profile::CodexUpstreamHeaderInput {
            auth_token,
            chatgpt_account_id: chatgpt_account_header,
            incoming_user_agent: incoming_headers.user_agent(),
            incoming_originator: incoming_headers.originator(),
            incoming_session_id: request_affinity.incoming_session_id,
            incoming_window_id: incoming_headers.window_id(),
            incoming_client_request_id: request_affinity.incoming_client_request_id,
            incoming_subagent: incoming_headers.subagent(),
            incoming_beta_features: incoming_headers.beta_features(),
            incoming_turn_metadata: incoming_headers.turn_metadata(),
            incoming_parent_thread_id: incoming_headers.parent_thread_id(),
            incoming_responsesapi_include_timing_metrics: incoming_headers
                .responsesapi_include_timing_metrics(),
            passthrough_codex_headers: incoming_headers.passthrough_codex_headers(),
            fallback_session_id: request_affinity.fallback_session_id,
            incoming_turn_state: request_affinity.incoming_turn_state,
            include_turn_state: true,
            strip_session_affinity,
            has_body: !body_for_transport.is_empty(),
        };
        super::super::header_profile::build_codex_upstream_headers(header_input)
    };
    if !request_ctx.transparent_mode && should_force_connection_close(target_url) {
        // 中文注释：本地 loopback mock/代理更容易复用到脏 keep-alive 连接；
        // 对 localhost/127.0.0.1 强制 close，避免请求落到已失效连接。
        force_connection_close(&mut upstream_headers);
    }
    let upstream_headers_uncompressed = upstream_headers.clone();
    let request_compression = if request_ctx.transparent_mode {
        RequestCompression::None
    } else {
        compression_override.unwrap_or_else(|| {
            resolve_request_compression(target_url, request_ctx.request_path, is_stream)
        })
    };
    let body_for_request = encode_request_body(
        request_ctx.request_path,
        &body_for_transport,
        request_compression,
        &mut upstream_headers,
    );
    let build_request = |http: &reqwest::blocking::Client,
                         request_headers: &[(String, String)],
                         request_body: &Bytes| {
        let mut builder = http.request(method.clone(), target_url);
        if let Some(timeout) =
            super::super::support::deadline::send_timeout(request_deadline, is_stream)
        {
            builder = builder.timeout(timeout);
        }
        for (name, value) in request_headers.iter() {
            builder = builder.header(name, value);
        }
        if !request_body.is_empty() {
            builder = builder.body(request_body.clone());
        }
        builder
    };

    let use_async_stream_transport =
        should_wrap_upstream_as_stream_response(request_ctx.request_path, is_stream);
    let result = if use_async_stream_transport {
        let async_client =
            super::super::super::async_upstream_client_for_account(account.id.as_str());
        match send_async_stream_request(
            &async_client,
            method,
            target_url,
            request_deadline,
            upstream_headers.as_slice(),
            &body_for_request,
            is_stream,
        ) {
            Ok(resp) => Ok(GatewayUpstreamResponse::Stream(resp)),
            Err(first_err) => {
                let fresh_async = super::super::super::fresh_async_upstream_client_for_account(
                    account.id.as_str(),
                );
                if should_retry_transport_without_compression(
                    target_url,
                    request_ctx.request_path,
                    is_stream,
                    request_compression,
                ) {
                    log::warn!(
                        "event=gateway_transport_retry_without_compression path={} account_id={} target_url={} first_err={}",
                        request_ctx.request_path,
                        account.id,
                        target_url,
                        first_err
                    );
                    match send_async_stream_request(
                        &fresh_async,
                        method,
                        target_url,
                        request_deadline,
                        upstream_headers_uncompressed.as_slice(),
                        &body_for_transport,
                        is_stream,
                    ) {
                        Ok(resp) => {
                            log::warn!(
                                "event=gateway_transport_retry_without_compression_succeeded path={} account_id={} target_url={}",
                                request_ctx.request_path,
                                account.id,
                                target_url
                            );
                            Ok(GatewayUpstreamResponse::Stream(resp))
                        }
                        Err(second_err) => {
                            log::warn!(
                                "event=gateway_transport_retry_without_compression_failed path={} account_id={} target_url={} first_err={} retry_err={}",
                                request_ctx.request_path,
                                account.id,
                                target_url,
                                first_err,
                                second_err
                            );
                            Err(second_err)
                        }
                    }
                } else {
                    match send_async_stream_request(
                        &fresh_async,
                        method,
                        target_url,
                        request_deadline,
                        upstream_headers.as_slice(),
                        &body_for_request,
                        is_stream,
                    ) {
                        Ok(resp) => {
                            log::info!(
                                "event=gateway_transport_retry_with_fresh_client_succeeded path={} account_id={} target_url={}",
                                request_ctx.request_path,
                                account.id,
                                target_url
                            );
                            Ok(GatewayUpstreamResponse::Stream(resp))
                        }
                        Err(second_err) => {
                            log::warn!(
                                "event=gateway_transport_retry_with_fresh_client_failed path={} account_id={} target_url={} first_err={} retry_err={}",
                                request_ctx.request_path,
                                account.id,
                                target_url,
                                first_err,
                                second_err
                            );
                            Err(second_err)
                        }
                    }
                }
            }
        }
    } else {
        match build_request(client, upstream_headers.as_slice(), &body_for_request).send() {
            Ok(resp) => Ok(resp.into()),
            Err(first_err) => {
                let fresh =
                    super::super::super::fresh_upstream_client_for_account(account.id.as_str());
                if should_retry_transport_without_compression(
                    target_url,
                    request_ctx.request_path,
                    is_stream,
                    request_compression,
                ) {
                    log::warn!(
                        "event=gateway_transport_retry_without_compression path={} account_id={} target_url={} first_err={}",
                        request_ctx.request_path,
                        account.id,
                        target_url,
                        first_err
                    );
                    match build_request(&fresh, upstream_headers_uncompressed.as_slice(), body)
                        .send()
                    {
                        Ok(resp) => {
                            log::warn!(
                                "event=gateway_transport_retry_without_compression_succeeded path={} account_id={} target_url={}",
                                request_ctx.request_path,
                                account.id,
                                target_url
                            );
                            Ok(resp.into())
                        }
                        Err(second_err) => {
                            log::warn!(
                                "event=gateway_transport_retry_without_compression_failed path={} account_id={} target_url={} first_err={} retry_err={}",
                                request_ctx.request_path,
                                account.id,
                                target_url,
                                first_err,
                                second_err
                            );
                            Err(second_err)
                        }
                    }
                } else {
                    match build_request(&fresh, upstream_headers.as_slice(), &body_for_request)
                        .send()
                    {
                        Ok(resp) => {
                            log::info!(
                                "event=gateway_transport_retry_with_fresh_client_succeeded path={} account_id={} target_url={}",
                                request_ctx.request_path,
                                account.id,
                                target_url
                            );
                            Ok(resp.into())
                        }
                        Err(second_err) => {
                            log::warn!(
                                "event=gateway_transport_retry_with_fresh_client_failed path={} account_id={} target_url={} first_err={} retry_err={}",
                                request_ctx.request_path,
                                account.id,
                                target_url,
                                first_err,
                                second_err
                            );
                            Err(second_err)
                        }
                    }
                }
            }
        }
    };
    let duration_ms = super::super::super::duration_to_millis(attempt_started_at.elapsed());
    super::super::super::metrics::record_gateway_upstream_attempt(duration_ms, result.is_err());
    result
}

#[cfg(test)]
mod tests {
    use super::{
        build_transparent_upstream_headers, encode_request_body,
        resolve_request_compression_with_flag, should_retry_transport_without_compression,
        should_wrap_upstream_as_stream_response, strip_compact_service_tier_for_transport,
        RequestCompression,
    };
    use crate::gateway::IncomingHeaderSnapshot;
    use axum::http::{HeaderMap, HeaderValue};
    use bytes::Bytes;

    fn header_value<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
        headers
            .iter()
            .find(|(header_name, _)| header_name.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    /// 函数 `request_compression_only_applies_to_streaming_chatgpt_responses`
    ///
    /// 作者: gaohongshun
    ///
    /// 时间: 2026-04-02
    ///
    /// # 参数
    /// 无
    ///
    /// # 返回
    /// 无
    #[test]
    fn request_compression_only_applies_to_streaming_chatgpt_responses() {
        assert_eq!(
            resolve_request_compression_with_flag(
                true,
                "https://chatgpt.com/backend-api/codex/responses",
                "/v1/responses",
                true
            ),
            RequestCompression::Zstd
        );
        assert_eq!(
            resolve_request_compression_with_flag(
                true,
                "https://chatgpt.com/backend-api/codex/responses",
                "/v1/responses/compact",
                true
            ),
            RequestCompression::None
        );
        assert_eq!(
            resolve_request_compression_with_flag(
                true,
                "https://api.openai.com/v1/responses",
                "/v1/responses",
                true
            ),
            RequestCompression::None
        );
        assert_eq!(
            resolve_request_compression_with_flag(
                true,
                "https://chatgpt.com/backend-api/codex/responses",
                "/v1/responses",
                false
            ),
            RequestCompression::None
        );
        assert_eq!(
            resolve_request_compression_with_flag(
                false,
                "https://chatgpt.com/backend-api/codex/responses",
                "/v1/responses",
                true
            ),
            RequestCompression::None
        );
    }

    #[test]
    fn transparent_headers_replace_auth_without_codex_profile_injection() {
        let mut headers = HeaderMap::new();
        headers.insert("Authorization", HeaderValue::from_static("Bearer platform"));
        headers.insert("User-Agent", HeaderValue::from_static("codex_cli_rs/1.0"));
        headers.insert("originator", HeaderValue::from_static("codex_cli_rs"));
        headers.insert("x-codex-window-id", HeaderValue::from_static("thread-1:0"));
        headers.insert("connection", HeaderValue::from_static("keep-alive"));
        let incoming = IncomingHeaderSnapshot::from_http_headers(&headers);

        let actual =
            build_transparent_upstream_headers(&incoming, "upstream-token", Some("acct_123"));

        assert_eq!(
            header_value(&actual, "Authorization"),
            Some("Bearer upstream-token")
        );
        assert_eq!(
            header_value(&actual, "ChatGPT-Account-ID"),
            Some("acct_123")
        );
        assert_eq!(
            header_value(&actual, "User-Agent"),
            Some("codex_cli_rs/1.0")
        );
        assert_eq!(header_value(&actual, "originator"), Some("codex_cli_rs"));
        assert_eq!(
            header_value(&actual, "x-codex-window-id"),
            Some("thread-1:0")
        );
        assert_eq!(header_value(&actual, "Connection"), None);
        assert_eq!(
            header_value(&actual, "x-openai-internal-codex-residency"),
            None
        );
    }

    /// 函数 `encode_request_body_adds_zstd_content_encoding`
    ///
    /// 作者: gaohongshun
    ///
    /// 时间: 2026-04-02
    ///
    /// # 参数
    /// 无
    ///
    /// # 返回
    /// 无
    #[test]
    fn encode_request_body_adds_zstd_content_encoding() {
        let body = Bytes::from_static(br#"{"model":"gpt-5.4","input":"compress me"}"#);
        let mut headers = vec![("Content-Type".to_string(), "application/json".to_string())];

        let actual = encode_request_body(
            "/v1/responses",
            &body,
            RequestCompression::Zstd,
            &mut headers,
        );

        assert!(headers.iter().any(|(name, value)| {
            name.eq_ignore_ascii_case("Content-Encoding") && value == "zstd"
        }));
        let decoded = zstd::stream::decode_all(std::io::Cursor::new(actual.as_ref()))
            .expect("decode zstd body");
        let value: serde_json::Value =
            serde_json::from_slice(&decoded).expect("parse decompressed json");
        assert_eq!(
            value.get("model").and_then(serde_json::Value::as_str),
            Some("gpt-5.4")
        );
    }

    #[test]
    fn compact_transport_strips_service_tier_without_chatgpt_account_header() {
        let body = Bytes::from_static(
            br#"{"model":"gpt-5.4","input":[],"service_tier":"priority","prompt_cache_key":"thread-1"}"#,
        );

        let actual = strip_compact_service_tier_for_transport(&body, false);
        let value: serde_json::Value =
            serde_json::from_slice(&actual).expect("parse stripped compact body");

        assert!(value.get("service_tier").is_none());
        assert_eq!(
            value
                .get("prompt_cache_key")
                .and_then(serde_json::Value::as_str),
            Some("thread-1")
        );
    }

    #[test]
    fn compact_transport_preserves_service_tier_with_chatgpt_account_header() {
        let body = Bytes::from_static(
            br#"{"model":"gpt-5.4","input":[],"service_tier":"priority","prompt_cache_key":"thread-1"}"#,
        );

        let actual = strip_compact_service_tier_for_transport(&body, true);
        let value: serde_json::Value =
            serde_json::from_slice(&actual).expect("parse preserved compact body");

        assert_eq!(
            value
                .get("service_tier")
                .and_then(serde_json::Value::as_str),
            Some("priority")
        );
    }

    #[test]
    fn transport_retry_without_compression_only_targets_streaming_chatgpt_responses() {
        assert!(should_retry_transport_without_compression(
            "https://chatgpt.com/backend-api/codex/responses",
            "/v1/responses",
            true,
            RequestCompression::Zstd
        ));
        assert!(!should_retry_transport_without_compression(
            "https://chatgpt.com/backend-api/codex/responses",
            "/v1/responses/compact",
            true,
            RequestCompression::Zstd
        ));
        assert!(!should_retry_transport_without_compression(
            "https://api.openai.com/v1/responses",
            "/v1/responses",
            true,
            RequestCompression::Zstd
        ));
        assert!(!should_retry_transport_without_compression(
            "https://chatgpt.com/backend-api/codex/responses",
            "/v1/responses",
            false,
            RequestCompression::Zstd
        ));
        assert!(!should_retry_transport_without_compression(
            "https://chatgpt.com/backend-api/codex/responses",
            "/v1/responses",
            true,
            RequestCompression::None
        ));
    }

    #[test]
    fn transport_wraps_non_compact_responses_streams_into_stream_variant() {
        assert!(should_wrap_upstream_as_stream_response(
            "/v1/responses",
            true
        ));
        assert!(should_wrap_upstream_as_stream_response(
            "/v1/responses?stream=false",
            true
        ));
        assert!(!should_wrap_upstream_as_stream_response(
            "/v1/responses/compact",
            true
        ));
        assert!(!should_wrap_upstream_as_stream_response(
            "/v1/chat/completions",
            true
        ));
        assert!(!should_wrap_upstream_as_stream_response(
            "/v1/responses",
            false
        ));
    }
}
