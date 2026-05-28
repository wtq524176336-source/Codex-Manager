use axum::body::Body;
use axum::extract::ws::{CloseFrame as ClientCloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::FromRequestParts;
use axum::http::header::{self, HeaderMap, HeaderValue};
use axum::http::{Request as HttpRequest, Response, StatusCode};
use base64::Engine as _;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::future::Future;
use std::net::IpAddr;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::client::{
    Request as WsClientRequest, Response as WsClientResponse,
};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode as UpstreamCloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame as UpstreamCloseFrame;
use tokio_tungstenite::tungstenite::Message as UpstreamMessage;
use tokio_tungstenite::{client_async_tls_with_config, connect_async_tls_with_config};

use crate::http::codex_source::{
    response_create_client_metadata, RESPONSES_ENDPOINT, X_CODEX_PARENT_THREAD_ID_HEADER,
    X_CODEX_TURN_METADATA_HEADER, X_CODEX_WINDOW_ID_HEADER, X_OPENAI_SUBAGENT_HEADER,
};
use crate::http::proxy_response::{text_error_response, text_response};
use crate::storage_helpers::{hash_platform_key, open_storage};

const RESPONSES_WS_ERROR_CODE: &str = "responses_websocket_error";
const WEBSOCKET_CONNECTION_LIMIT_REACHED_CODE: &str = "websocket_connection_limit_reached";

fn websocket_text_sha256_16(text: &str) -> String {
    use std::fmt::Write as _;

    let digest = Sha256::digest(text.as_bytes());
    let mut output = String::with_capacity(16);
    for byte in digest.iter().take(8) {
        let _ = write!(&mut output, "{byte:02x}");
    }
    output
}

fn fingerprint_or_dash(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(websocket_text_sha256_16)
        .unwrap_or_else(|| "-".to_string())
}

#[derive(Clone)]
struct WsRequestContext {
    api_key: codexmanager_core::storage::ApiKey,
    incoming_headers: crate::gateway::IncomingHeaderSnapshot,
    prompt_cache_key: Option<String>,
    effective_upstream_base: String,
    prefer_raw_errors: bool,
    transparent_mode: bool,
}

#[derive(Clone)]
struct PreparedClientFrame {
    text: String,
    upstream_message: UpstreamMessage,
    model: Option<String>,
    reasoning_effort: Option<String>,
    service_tier: Option<String>,
    effective_service_tier: Option<String>,
    raw_service_tier: Option<String>,
    has_service_tier_field: bool,
}

struct PendingWsRequestState {
    log: PendingWsRequestLog,
    prepared: PreparedClientFrame,
    forwarded_upstream_event: bool,
}

struct ConnectedUpstreamWebsocket {
    stream: tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>,
    account_id: String,
    upstream_url: String,
}

struct WebsocketTarget {
    host: String,
    port: u16,
    authority: String,
}

struct PendingWsRequestLog {
    trace_id: String,
    model: Option<String>,
    reasoning_effort: Option<String>,
    service_tier: Option<String>,
    effective_service_tier: Option<String>,
    started_at: Instant,
    first_response_ms: Option<i64>,
    output_text: String,
}

struct WsFrameDiagnostics {
    request_type: String,
    previous_response_id_present: bool,
    previous_response_id_fp: String,
    response_id_fp: String,
    generate: String,
}

struct WsSessionError {
    status: u16,
    code: String,
    message: String,
}

impl WsSessionError {
    fn new(status: u16, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            status,
            code: code.into(),
            message: message.into(),
        }
    }

    fn bad_request(message: impl Into<String>) -> Self {
        Self::new(400, "invalid_request_error", message)
    }

    fn bad_gateway(message: impl Into<String>) -> Self {
        Self::new(502, RESPONSES_WS_ERROR_CODE, message)
    }

    fn service_unavailable(message: impl Into<String>) -> Self {
        Self::new(503, RESPONSES_WS_ERROR_CODE, message)
    }

    fn bad_request_bilingual(
        chinese_description: impl AsRef<str>,
        english_raw_message: impl AsRef<str>,
    ) -> Self {
        Self::bad_request(crate::gateway::bilingual_error(
            chinese_description,
            english_raw_message,
        ))
    }

    fn bad_gateway_bilingual(
        chinese_description: impl AsRef<str>,
        english_raw_message: impl AsRef<str>,
    ) -> Self {
        Self::bad_gateway(crate::gateway::bilingual_error(
            chinese_description,
            english_raw_message,
        ))
    }

    fn service_unavailable_bilingual(
        chinese_description: impl AsRef<str>,
        english_raw_message: impl AsRef<str>,
    ) -> Self {
        Self::service_unavailable(crate::gateway::bilingual_error(
            chinese_description,
            english_raw_message,
        ))
    }
}

pub(super) fn is_websocket_upgrade_request(headers: &HeaderMap) -> bool {
    let upgrade_is_websocket = headers
        .get_all(header::UPGRADE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .any(|value| value.eq_ignore_ascii_case("websocket"));
    let connection_has_upgrade = headers
        .get_all(header::CONNECTION)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .any(|value| {
            value
                .split(',')
                .any(|token| token.trim().eq_ignore_ascii_case("upgrade"))
        });
    let has_websocket_key = headers.contains_key("sec-websocket-key");
    upgrade_is_websocket && (connection_has_upgrade || has_websocket_key)
}

pub(super) async fn upgrade_responses_websocket(request: HttpRequest<Body>) -> Response<Body> {
    let (mut parts, _) = request.into_parts();

    let context = match authorize_websocket_request(&parts.headers) {
        Ok(context) => context,
        Err(response) => return response,
    };
    log::info!(
        "event=responses_ws_upgrade_accepted api_key_id={} transparent_mode={}",
        context.api_key.id,
        context.transparent_mode
    );

    let ws = match WebSocketUpgrade::from_request_parts(&mut parts, &()).await {
        Ok(ws) => ws,
        Err(err) => {
            return text_error_response(
                StatusCode::BAD_REQUEST,
                crate::gateway::error_message_for_client(
                    context.prefer_raw_errors,
                    crate::gateway::bilingual_error(
                        "WebSocket 升级失败",
                        format!("websocket upgrade rejected: {err}"),
                    ),
                ),
            );
        }
    };

    ws.on_upgrade(move |socket| async move {
        run_responses_websocket_session(socket, context).await;
    })
}

async fn run_responses_websocket_session(mut socket: WebSocket, context: WsRequestContext) {
    let first_message = match receive_initial_request(&mut socket).await {
        Ok(Some(message)) => message,
        Ok(None) => return,
        Err(err) => {
            send_ws_error_and_close(&mut socket, err, context.prefer_raw_errors).await;
            return;
        }
    };

    let prepared_first = match prepare_initial_client_frame(first_message, &context) {
        Ok(prepared) => prepared,
        Err(err) => {
            send_ws_error_and_close(&mut socket, err, context.prefer_raw_errors).await;
            return;
        }
    };

    let mut upstream =
        match connect_upstream_websocket(&context, prepared_first.model.as_deref()).await {
            Ok(stream) => stream,
            Err(err) => {
                send_ws_error_and_close(&mut socket, err, context.prefer_raw_errors).await;
                return;
            }
        };
    let first_pending = PendingWsRequestState {
        log: begin_ws_request_log(&context, &prepared_first),
        prepared: prepared_first.clone(),
        forwarded_upstream_event: false,
    };
    log_ws_frame_route(
        &context,
        &first_pending,
        upstream.account_id.as_str(),
        upstream.upstream_url.as_str(),
        "initial",
    );

    if let Err(err) = upstream
        .stream
        .send(first_pending.prepared.upstream_message.clone())
        .await
    {
        finalize_ws_request_log(
            &context,
            &first_pending.log,
            Some(upstream.account_id.as_str()),
            Some(upstream.upstream_url.as_str()),
            502,
            crate::gateway::RequestLogUsage::default(),
            Some(crate::gateway::bilingual_error(
                "发送上游 WebSocket 首帧失败",
                format!("send first upstream websocket frame failed: {err}"),
            )),
        );
        send_ws_error_and_close(
            &mut socket,
            WsSessionError::bad_gateway_bilingual(
                "发送上游 WebSocket 首帧失败",
                format!("send first upstream websocket frame failed: {err}"),
            ),
            context.prefer_raw_errors,
        )
        .await;
        return;
    }
    let mut pending_request = Some(first_pending);

    loop {
        tokio::select! {
            maybe_client = socket.recv() => {
                let Some(client_result) = maybe_client else {
                    let _ = upstream.stream.close(None).await;
                    break;
                };
                match client_result {
                    Ok(Message::Text(text)) => {
                        match rewrite_client_frame(text.as_str(), &context) {
                            Ok(prepared) => {
                                if let Some(previous_pending) = pending_request.take() {
                                    finalize_ws_request_log(
                                        &context,
                                        &previous_pending.log,
                                        Some(upstream.account_id.as_str()),
                                        Some(upstream.upstream_url.as_str()),
                                        499,
                                        crate::gateway::RequestLogUsage::default(),
                                        Some(crate::gateway::bilingual_error(
                                            "WebSocket 请求在完成前被覆盖",
                                            "websocket request superseded before completion",
                                        )),
                                    );
                                }
                                let current_pending = PendingWsRequestState {
                                    log: begin_ws_request_log(&context, &prepared),
                                    prepared,
                                    forwarded_upstream_event: false,
                                };
                                log_ws_frame_route(
                                    &context,
                                    &current_pending,
                                    upstream.account_id.as_str(),
                                    upstream.upstream_url.as_str(),
                                    "client",
                                );
                                if let Err(err) = upstream
                                    .stream
                                    .send(current_pending.prepared.upstream_message.clone())
                                    .await
                                {
                                    finalize_ws_request_log(
                                        &context,
                                        &current_pending.log,
                                        Some(upstream.account_id.as_str()),
                                        Some(upstream.upstream_url.as_str()),
                                        502,
                                        crate::gateway::RequestLogUsage::default(),
                                        Some(crate::gateway::bilingual_error(
                                            "发送上游 WebSocket 帧失败",
                                            format!("send upstream websocket frame failed: {err}"),
                                        )),
                                    );
                                    send_ws_error_and_close(
                                        &mut socket,
                                        WsSessionError::bad_gateway_bilingual(
                                            "发送上游 WebSocket 帧失败",
                                            format!("send upstream websocket frame failed: {err}"),
                                        ),
                                        context.prefer_raw_errors,
                                    ).await;
                                    let _ = upstream.stream.close(None).await;
                                    break;
                                }
                                pending_request = Some(current_pending);
                            }
                            Err(err) => {
                                send_ws_error_and_close(&mut socket, err, context.prefer_raw_errors).await;
                                let _ = upstream.stream.close(None).await;
                                break;
                            }
                        }
                    }
                    Ok(Message::Ping(payload)) => {
                        let _ = upstream.stream.send(UpstreamMessage::Ping(payload)).await;
                    }
                    Ok(Message::Pong(payload)) => {
                        let _ = upstream.stream.send(UpstreamMessage::Pong(payload)).await;
                    }
                    Ok(Message::Binary(bytes)) => {
                        if let Err(err) = upstream.stream.send(UpstreamMessage::Binary(bytes)).await {
                            send_ws_error_and_close(
                                &mut socket,
                                WsSessionError::bad_gateway_bilingual(
                                    "发送上游 WebSocket 二进制消息失败",
                                    format!("send upstream websocket binary failed: {err}"),
                                ),
                                context.prefer_raw_errors,
                            ).await;
                            break;
                        }
                    }
                    Ok(Message::Close(frame)) => {
                        let _ = upstream
                            .stream
                            .send(UpstreamMessage::Close(
                                frame.map(client_close_frame_to_upstream),
                            ))
                            .await;
                        break;
                    }
                    Err(err) => {
                        send_ws_error_and_close(
                            &mut socket,
                            WsSessionError::bad_request_bilingual(
                                "接收客户端 WebSocket 帧失败",
                                format!("receive client websocket frame failed: {err}"),
                            ),
                            context.prefer_raw_errors,
                        ).await;
                        let _ = upstream.stream.close(None).await;
                        break;
                    }
                }
            }
            maybe_upstream = upstream.stream.next() => {
                let Some(upstream_result) = maybe_upstream else {
                    let _ = socket.close().await;
                    break;
                };
                match upstream_result {
                    Ok(UpstreamMessage::Text(text)) => {
                        if let Some(pending) = pending_request.as_mut() {
                            collect_ws_output_text_from_frame(
                                &mut pending.log.output_text,
                                text.as_str(),
                            );
                        }
                        if let Some(terminal) = inspect_ws_terminal_event(text.as_str()) {
                            if let Some(pending) = pending_request.as_ref() {
                                log_ws_terminal_diagnostic(
                                    &context,
                                    &upstream,
                                    pending,
                                    &terminal,
                                    "received",
                                );
                            }
                            let retry_model = pending_request
                                .as_ref()
                                .and_then(|pending| pending.prepared.model.clone());
                            let retry_succeeded = if let Some(pending) = pending_request.as_mut() {
                                if !pending.forwarded_upstream_event {
                                    try_retry_ws_request_after_terminal(&context, &mut upstream, pending, &terminal).await
                                } else {
                                    false
                                }
                            } else {
                                false
                            };
                            if retry_succeeded {
                                continue;
                            }

                            if let Some(mut pending) = pending_request.take() {
                                mark_ws_first_response(&mut pending);
                                finalize_ws_request_log(
                                    &context,
                                    &pending.log,
                                    Some(upstream.account_id.as_str()),
                                    Some(upstream.upstream_url.as_str()),
                                    terminal.status_code,
                                    terminal.usage,
                                    terminal.error,
                                );
                            }
                            if let Err(err) = socket
                                .send(Message::Text(text.to_string().into()))
                                .await
                            {
                                log::warn!("event=responses_ws_client_send_terminal_failed err={err}");
                                break;
                            }
                            let _ = retry_model;
                            continue;
                        }

                        if let Some(pending) = pending_request.as_mut() {
                            mark_ws_first_response(pending);
                        }
                        if let Err(err) = socket
                            .send(Message::Text(text.to_string().into()))
                            .await
                        {
                            log::warn!("event=responses_ws_client_send_failed err={err}");
                            break;
                        }
                    }
                    Ok(UpstreamMessage::Binary(bytes)) => {
                        if let Err(err) = socket.send(Message::Binary(bytes)).await {
                            log::warn!("event=responses_ws_client_send_binary_failed err={err}");
                            break;
                        }
                    }
                    Ok(UpstreamMessage::Ping(payload)) => {
                        let _ = socket.send(Message::Ping(payload)).await;
                    }
                    Ok(UpstreamMessage::Pong(payload)) => {
                        let _ = socket.send(Message::Pong(payload)).await;
                    }
                    Ok(UpstreamMessage::Close(frame)) => {
                        let _ = socket
                            .send(Message::Close(frame.map(upstream_close_frame_to_client)))
                            .await;
                        break;
                    }
                    Ok(UpstreamMessage::Frame(_)) => {}
                    Err(err) => {
                        send_ws_error_and_close(
                            &mut socket,
                            WsSessionError::bad_gateway_bilingual(
                                "接收上游 WebSocket 帧失败",
                                format!("receive upstream websocket frame failed: {err}"),
                            ),
                            context.prefer_raw_errors,
                        ).await;
                        break;
                    }
                }
            }
        }
    }
}

fn client_close_frame_to_upstream(frame: ClientCloseFrame) -> UpstreamCloseFrame {
    UpstreamCloseFrame {
        code: UpstreamCloseCode::from(frame.code),
        reason: frame.reason.to_string().into(),
    }
}

fn upstream_close_frame_to_client(frame: UpstreamCloseFrame) -> ClientCloseFrame {
    ClientCloseFrame {
        code: frame.code.into(),
        reason: frame.reason.to_string().into(),
    }
}

fn authorize_websocket_request(headers: &HeaderMap) -> Result<WsRequestContext, Response<Body>> {
    let prefer_raw_errors = crate::gateway::prefers_raw_errors_for_http_headers(headers);
    let incoming_headers = crate::gateway::IncomingHeaderSnapshot::from_http_headers(headers);
    let transparent_mode = incoming_headers.is_native_codex_client();
    let Some(platform_key) = incoming_headers.platform_key() else {
        return Err(text_error_response(
            StatusCode::UNAUTHORIZED,
            crate::gateway::error_message_for_client(
                prefer_raw_errors,
                crate::gateway::bilingual_error("缺少平台 API Key", "missing platform api key"),
            ),
        ));
    };

    let storage = open_storage().ok_or_else(|| {
        text_error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            crate::gateway::error_message_for_client(
                prefer_raw_errors,
                crate::gateway::bilingual_error("存储不可用", "storage unavailable"),
            ),
        )
    })?;
    let api_key = storage
        .find_api_key_by_hash(&hash_platform_key(platform_key))
        .map_err(|err| {
            text_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                crate::gateway::error_message_for_client(
                    prefer_raw_errors,
                    crate::gateway::bilingual_error(
                        "读取存储失败",
                        format!("storage read failed: {err}"),
                    ),
                ),
            )
        })?
        .ok_or_else(|| {
            text_error_response(
                StatusCode::FORBIDDEN,
                crate::gateway::error_message_for_client(
                    prefer_raw_errors,
                    crate::gateway::bilingual_error(
                        "平台 API Key 不存在",
                        "platform api key not found",
                    ),
                ),
            )
        })?;

    if !crate::gateway::gateway_supports_official_responses_websocket(&api_key) {
        return Err(upgrade_required_response(
            crate::gateway::error_message_for_client(
                prefer_raw_errors,
                crate::gateway::bilingual_error(
                    "Responses WebSocket 仅支持官方 Codex 上游",
                    "responses websocket is only available for official Codex upstream",
                ),
            ),
        ));
    }

    let (incoming_headers, prompt_cache_key) = if transparent_mode {
        (incoming_headers, None)
    } else {
        crate::gateway::gateway_resolve_ws_prompt_cache_key(&storage, &api_key, &incoming_headers)
            .map_err(|err| {
            text_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                crate::gateway::error_message_for_client(
                    prefer_raw_errors,
                    crate::gateway::bilingual_error("读取会话绑定失败", err),
                ),
            )
        })?
    };

    Ok(WsRequestContext {
        effective_upstream_base: crate::gateway::gateway_resolve_effective_upstream_base(&api_key),
        api_key,
        incoming_headers,
        prompt_cache_key,
        prefer_raw_errors,
        transparent_mode,
    })
}

async fn receive_initial_request(
    socket: &mut WebSocket,
) -> Result<Option<Message>, WsSessionError> {
    loop {
        let Some(message) = socket.recv().await else {
            return Ok(None);
        };
        match message {
            Ok(Message::Text(text)) => return Ok(Some(Message::Text(text))),
            Ok(Message::Binary(bytes)) => return Ok(Some(Message::Binary(bytes))),
            Ok(Message::Ping(payload)) => {
                let _ = socket.send(Message::Pong(payload)).await;
            }
            Ok(Message::Pong(_)) => {}
            Ok(Message::Close(_)) => return Ok(None),
            Err(err) => {
                return Err(WsSessionError::bad_request_bilingual(
                    "接收首个 WebSocket 帧失败",
                    format!("receive initial websocket frame failed: {err}"),
                ));
            }
        }
    }
}

fn prepare_initial_client_frame(
    message: Message,
    context: &WsRequestContext,
) -> Result<PreparedClientFrame, WsSessionError> {
    match message {
        Message::Text(text) => rewrite_client_frame(text.as_str(), context),
        Message::Binary(bytes) if context.transparent_mode => Ok(PreparedClientFrame {
            text: String::new(),
            upstream_message: UpstreamMessage::Binary(bytes),
            model: None,
            reasoning_effort: None,
            service_tier: None,
            effective_service_tier: None,
            raw_service_tier: None,
            has_service_tier_field: false,
        }),
        Message::Binary(_) => Err(WsSessionError::bad_request_bilingual(
            "首个 WebSocket 帧必须是 response.create 文本帧",
            "initial websocket frame must be a response.create text frame",
        )),
        Message::Ping(_) | Message::Pong(_) | Message::Close(_) => {
            Err(WsSessionError::bad_request_bilingual(
                "首个 WebSocket 数据帧无效",
                "initial websocket data frame is invalid",
            ))
        }
    }
}

fn rewrite_client_frame(
    text: &str,
    context: &WsRequestContext,
) -> Result<PreparedClientFrame, WsSessionError> {
    if context.transparent_mode {
        let parsed_payload = serde_json::from_str::<Value>(text).ok();
        let object = parsed_payload.as_ref().and_then(Value::as_object);
        let response_object = object
            .and_then(|object| object.get("response"))
            .and_then(Value::as_object);
        let field = |name: &str| -> Option<&Value> {
            object
                .and_then(|object| object.get(name))
                .or_else(|| response_object.and_then(|object| object.get(name)))
        };
        let service_tier_diagnostic =
            crate::gateway::inspect_service_tier_value(field("service_tier"));
        let reasoning_effort = field("reasoning")
            .and_then(|value| value.get("effort"))
            .and_then(Value::as_str)
            .map(str::to_string);
        let effective_service_tier = service_tier_diagnostic.normalized_value.clone();
        return Ok(PreparedClientFrame {
            text: text.to_string(),
            upstream_message: UpstreamMessage::Text(text.to_string().into()),
            model: field("model").and_then(Value::as_str).map(str::to_string),
            reasoning_effort,
            service_tier: service_tier_diagnostic.normalized_value,
            effective_service_tier,
            raw_service_tier: service_tier_diagnostic.raw_value,
            has_service_tier_field: service_tier_diagnostic.has_field,
        });
    }

    let mut payload = serde_json::from_str::<Value>(text).map_err(|err| {
        WsSessionError::bad_request_bilingual(
            "WebSocket JSON 载荷无效",
            format!("invalid websocket json payload: {err}"),
        )
    })?;
    let Some(object) = payload.as_object_mut() else {
        return Err(WsSessionError::bad_request_bilingual(
            "WebSocket 载荷必须是 JSON 对象",
            "websocket payload must be a JSON object",
        ));
    };
    let message_type = object
        .remove("type")
        .and_then(|value| value.as_str().map(str::to_string))
        .ok_or_else(|| {
            WsSessionError::bad_request_bilingual(
                "WebSocket 载荷缺少 type=response.create",
                "websocket payload missing type=response.create",
            )
        })?;
    if message_type != "response.create" {
        return Err(WsSessionError::bad_request_bilingual(
            "不支持的 WebSocket 消息类型",
            format!("unsupported websocket message type: {message_type}"),
        ));
    }

    let service_tier_diagnostic =
        crate::gateway::inspect_service_tier_value(object.get("service_tier"));
    let explicit_service_tier_for_log = service_tier_diagnostic.normalized_value.clone();
    let previous_response_id = object.remove("previous_response_id");
    let generate = object.remove("generate");
    let client_metadata = object.remove("client_metadata");
    let client_passthrough_fields = object.clone();

    let rewritten_body = crate::gateway::gateway_rewrite_ws_responses_body(
        RESPONSES_ENDPOINT,
        serde_json::to_vec(&Value::Object(object.clone())).map_err(|err| {
            WsSessionError::bad_request_bilingual(
                "序列化 WebSocket 请求失败",
                format!("serialize websocket payload failed: {err}"),
            )
        })?,
        &context.api_key,
        context.prompt_cache_key.as_deref(),
    );
    let mut rewritten_value = serde_json::from_slice::<Value>(&rewritten_body).map_err(|err| {
        WsSessionError::bad_gateway_bilingual(
            "重写 WebSocket 请求失败",
            format!("rewrite websocket payload failed: {err}"),
        )
    })?;
    let Some(rewritten_object) = rewritten_value.as_object_mut() else {
        return Err(WsSessionError::bad_gateway_bilingual(
            "重写后的 WebSocket 请求不是对象",
            "rewritten websocket payload must be a JSON object",
        ));
    };
    if let Some(previous_response_id) = previous_response_id {
        rewritten_object.insert("previous_response_id".to_string(), previous_response_id);
    }
    if let Some(generate) = generate {
        rewritten_object.insert("generate".to_string(), generate);
    }
    let merged_client_metadata = merge_client_metadata(
        rewritten_object.remove("client_metadata"),
        client_metadata,
        &context.incoming_headers,
    );
    if let Some(client_metadata) = merged_client_metadata {
        rewritten_object.insert("client_metadata".to_string(), client_metadata);
    }
    let mut restored_keys = Vec::new();
    for (key, value) in client_passthrough_fields {
        if key == "stream_passthrough" {
            continue;
        }
        if !rewritten_object.contains_key(&key) {
            restored_keys.push(key.clone());
            rewritten_object.insert(key, value);
        }
    }
    if !restored_keys.is_empty() {
        restored_keys.sort_unstable();
        log::debug!(
            "event=responses_ws_passthrough_fields_restored api_key_id={} keys={}",
            context.api_key.id,
            restored_keys.join(",")
        );
    }

    let model = rewritten_object
        .get("model")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            WsSessionError::bad_request_bilingual(
                "重写后的 WebSocket 请求缺少 model 字段",
                "rewritten websocket request missing model field",
            )
        })?;
    let effective_service_tier = rewritten_object
        .get("service_tier")
        .and_then(Value::as_str)
        .and_then(crate::apikey::service_tier::normalize_service_tier_for_log)
        .map(str::to_string);
    let reasoning_effort = rewritten_object
        .get("reasoning")
        .and_then(|value| value.get("effort"))
        .and_then(Value::as_str)
        .map(str::to_string);

    let mut final_payload = rewritten_object.clone();
    final_payload.insert(
        "type".to_string(),
        Value::String("response.create".to_string()),
    );
    let text = serde_json::to_string(&Value::Object(final_payload)).map_err(|err| {
        WsSessionError::bad_request_bilingual(
            "序列化官方 Codex WebSocket 请求失败",
            format!("serialize official codex websocket request failed: {err}"),
        )
    })?;

    Ok(PreparedClientFrame {
        upstream_message: UpstreamMessage::Text(text.clone().into()),
        text,
        model: Some(model),
        reasoning_effort,
        service_tier: explicit_service_tier_for_log,
        effective_service_tier,
        raw_service_tier: service_tier_diagnostic.raw_value,
        has_service_tier_field: service_tier_diagnostic.has_field,
    })
}

fn merge_metadata_value(mapped: &mut HashMap<String, String>, client_metadata: Option<Value>) {
    if let Some(Value::Object(object)) = client_metadata {
        for (key, value) in object {
            if let Some(value) = value.as_str() {
                mapped.insert(key, value.to_string());
            } else if let Some(value) = value.as_i64() {
                mapped.insert(key, value.to_string());
            } else if let Some(value) = value.as_u64() {
                mapped.insert(key, value.to_string());
            } else if let Some(value) = value.as_bool() {
                mapped.insert(key, value.to_string());
            }
        }
    }
}

fn insert_header_metadata(mapped: &mut HashMap<String, String>, key: &str, value: Option<&str>) {
    if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
        mapped.insert(key.to_string(), value.to_string());
    }
}

fn ws_text_field<'a>(value: &'a Value, name: &str) -> Option<&'a str> {
    value
        .get(name)
        .and_then(Value::as_str)
        .or_else(|| {
            value
                .get("response")
                .and_then(|response| response.get(name))
                .and_then(Value::as_str)
        })
}

fn ws_frame_diagnostics(text: &str) -> WsFrameDiagnostics {
    let parsed = serde_json::from_str::<Value>(text).ok();
    let request_type = parsed
        .as_ref()
        .and_then(|value| ws_text_field(value, "type"))
        .unwrap_or("-")
        .to_string();
    let previous_response_id = parsed
        .as_ref()
        .and_then(|value| ws_text_field(value, "previous_response_id"));
    let response_id = parsed
        .as_ref()
        .and_then(|value| ws_text_field(value, "response_id"));
    let generate = parsed
        .as_ref()
        .and_then(|value| value.get("generate"))
        .and_then(Value::as_bool)
        .map(|value| value.to_string())
        .unwrap_or_else(|| "-".to_string());

    WsFrameDiagnostics {
        request_type,
        previous_response_id_present: previous_response_id.is_some(),
        previous_response_id_fp: fingerprint_or_dash(previous_response_id),
        response_id_fp: fingerprint_or_dash(response_id),
        generate,
    }
}

fn log_ws_frame_route(
    context: &WsRequestContext,
    pending: &PendingWsRequestState,
    account_id: &str,
    upstream_url: &str,
    phase: &str,
) {
    let diagnostics = ws_frame_diagnostics(pending.prepared.text.as_str());
    log::info!(
        "event=responses_ws_frame_route trace_id={} phase={} api_key_id={} account_id={} transparent_mode={} request_type={} model={} previous_response_id_present={} previous_response_id_fp={} response_id_fp={} generate={} turn_state_present={} turn_state_fp={} thread_id_fp={} session_id_fp={} client_request_id_fp={} frame_len={} frame_sha256_16={} upstream_url={}",
        pending.log.trace_id.as_str(),
        phase,
        context.api_key.id.as_str(),
        account_id,
        context.transparent_mode,
        diagnostics.request_type.as_str(),
        pending.prepared.model.as_deref().unwrap_or("-"),
        diagnostics.previous_response_id_present,
        diagnostics.previous_response_id_fp.as_str(),
        diagnostics.response_id_fp.as_str(),
        diagnostics.generate.as_str(),
        context.incoming_headers.turn_state().is_some(),
        fingerprint_or_dash(context.incoming_headers.turn_state()),
        fingerprint_or_dash(context.incoming_headers.thread_id()),
        fingerprint_or_dash(context.incoming_headers.session_id()),
        fingerprint_or_dash(context.incoming_headers.client_request_id()),
        pending.prepared.text.len(),
        websocket_text_sha256_16(pending.prepared.text.as_str()),
        upstream_url
    );
}

fn merge_client_metadata(
    rewritten_metadata: Option<Value>,
    client_metadata: Option<Value>,
    incoming_headers: &crate::gateway::IncomingHeaderSnapshot,
) -> Option<Value> {
    let mut mapped = HashMap::new();
    merge_metadata_value(&mut mapped, client_metadata);
    merge_metadata_value(&mut mapped, rewritten_metadata);
    insert_header_metadata(
        &mut mapped,
        X_CODEX_TURN_METADATA_HEADER,
        incoming_headers.turn_metadata(),
    );
    insert_header_metadata(
        &mut mapped,
        X_CODEX_WINDOW_ID_HEADER,
        incoming_headers.window_id(),
    );
    insert_header_metadata(
        &mut mapped,
        X_OPENAI_SUBAGENT_HEADER,
        incoming_headers.subagent(),
    );
    insert_header_metadata(
        &mut mapped,
        X_CODEX_PARENT_THREAD_ID_HEADER,
        incoming_headers.parent_thread_id(),
    );
    response_create_client_metadata((!mapped.is_empty()).then_some(mapped))
        .and_then(|value| serde_json::to_value(value).ok())
}

async fn connect_upstream_websocket(
    context: &WsRequestContext,
    model: Option<&str>,
) -> Result<ConnectedUpstreamWebsocket, WsSessionError> {
    let storage = open_storage().ok_or_else(|| {
        WsSessionError::service_unavailable_bilingual("存储不可用", "storage unavailable")
    })?;
    let candidates =
        crate::gateway::gateway_collect_routed_candidates(&storage, &context.api_key.id, model)?;
    if candidates.is_empty() {
        return Err(WsSessionError::service_unavailable_bilingual(
            "没有可用的上游账号",
            "no available upstream accounts",
        ));
    }

    let ws_url = build_upstream_websocket_url(&context.effective_upstream_base)?;
    let mut last_error = None;
    ensure_rustls_crypto_provider();
    for (account, token) in candidates {
        let bearer = match resolve_bearer_token_for_websocket(account.clone(), token).await {
            Ok(token) => token,
            Err(err) => {
                last_error = Some(format!(
                    "resolve bearer token for account {} failed: {err}",
                    account.id
                ));
                continue;
            }
        };
        let request =
            build_upstream_websocket_request(ws_url.as_str(), &account, bearer.as_str(), context)?;
        match connect_upstream_websocket_for_account(request, ws_url.as_str(), &account, context)
            .await
        {
            Ok((stream, _)) => {
                return Ok(ConnectedUpstreamWebsocket {
                    stream,
                    account_id: account.id,
                    upstream_url: ws_url.clone(),
                });
            }
            Err(err) => {
                last_error = Some(format!(
                    "connect upstream websocket for account {} failed: {err}",
                    account.id
                ));
            }
        }
    }

    Err(WsSessionError::bad_gateway_bilingual(
        "连接上游 WebSocket 失败",
        last_error.unwrap_or_else(|| "connect upstream websocket failed".to_string()),
    ))
}

async fn resolve_bearer_token_for_websocket(
    account: codexmanager_core::storage::Account,
    token: codexmanager_core::storage::Token,
) -> Result<String, String> {
    let join_result = tokio::task::spawn_blocking(move || {
        let storage = open_storage()
            .ok_or_else(|| crate::gateway::bilingual_error("存储不可用", "storage unavailable"))?;
        let mut token = token;
        crate::gateway::gateway_resolve_openai_bearer_token(&storage, &account, &mut token)
    })
    .await;

    match join_result {
        Ok(result) => result,
        Err(err) => Err(crate::gateway::bilingual_error(
            "Bearer Token 任务合并失败",
            format!("bearer token task join failed: {err}"),
        )),
    }
}

fn build_upstream_websocket_url(upstream_base: &str) -> Result<String, WsSessionError> {
    let (target_url, _) =
        crate::gateway::gateway_compute_upstream_url(upstream_base, RESPONSES_ENDPOINT);
    let mut url = url::Url::parse(target_url.as_str()).map_err(|err| {
        WsSessionError::bad_gateway_bilingual(
            "上游 WebSocket URL 无效",
            format!("invalid upstream websocket url: {err}"),
        )
    })?;
    match url.scheme() {
        "http" => {
            let _ = url.set_scheme("ws");
        }
        "https" => {
            let _ = url.set_scheme("wss");
        }
        "ws" | "wss" => {}
        other => {
            return Err(WsSessionError::bad_gateway_bilingual(
                "不支持的上游 WebSocket 协议",
                format!("unsupported upstream websocket scheme: {other}"),
            ));
        }
    }
    Ok(url.to_string())
}

struct WsProxySelection {
    url: Option<String>,
    source: &'static str,
}

async fn connect_upstream_websocket_for_account(
    request: WsClientRequest,
    ws_url: &str,
    account: &codexmanager_core::storage::Account,
    context: &WsRequestContext,
) -> Result<
    (
        tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>,
        WsClientResponse,
    ),
    String,
> {
    let proxy = websocket_proxy_selection_for_account(account.id.as_str(), ws_url);
    let proxy_log = proxy
        .url
        .as_deref()
        .map(sanitize_proxy_url_for_log)
        .unwrap_or_else(|| "direct".to_string());
    let started_at = Instant::now();
    let connect_timeout_ms = websocket_connect_timeout().as_millis();
    log::info!(
        "event=responses_ws_upstream_connect_start api_key_id={} account_id={} upstream_url={} proxy_source={} proxy={} transparent_mode={} incoming_turn_state_present={} incoming_turn_state_fp={} thread_id_fp={} session_id_fp={} client_request_id_fp={} connect_timeout_ms={}",
        context.api_key.id,
        account.id,
        ws_url,
        proxy.source,
        proxy_log,
        context.transparent_mode,
        context.incoming_headers.turn_state().is_some(),
        fingerprint_or_dash(context.incoming_headers.turn_state()),
        fingerprint_or_dash(context.incoming_headers.thread_id()),
        fingerprint_or_dash(context.incoming_headers.session_id()),
        fingerprint_or_dash(context.incoming_headers.client_request_id()),
        connect_timeout_ms
    );
    let result = connect_upstream_websocket_request(request, ws_url, proxy.url.as_deref()).await;
    match &result {
        Ok((_, response)) => {
            let upstream_turn_state = response
                .headers()
                .get(crate::http::codex_source::X_CODEX_TURN_STATE_HEADER)
                .and_then(|value| value.to_str().ok());
            log::info!(
                "event=responses_ws_upstream_connect_ok api_key_id={} account_id={} upstream_url={} proxy_source={} elapsed_ms={} incoming_turn_state_present={} incoming_turn_state_fp={} upstream_turn_state_present={} upstream_turn_state_fp={}",
                context.api_key.id,
                account.id,
                ws_url,
                proxy.source,
                started_at.elapsed().as_millis(),
                context.incoming_headers.turn_state().is_some(),
                fingerprint_or_dash(context.incoming_headers.turn_state()),
                upstream_turn_state.is_some(),
                fingerprint_or_dash(upstream_turn_state)
            );
        }
        Err(err) => log::warn!(
            "event=responses_ws_upstream_connect_failed api_key_id={} account_id={} upstream_url={} proxy_source={} proxy={} elapsed_ms={} err={}",
            context.api_key.id,
            account.id,
            ws_url,
            proxy.source,
            proxy_log,
            started_at.elapsed().as_millis(),
            err
        ),
    }
    result
}

fn websocket_proxy_selection_for_account(account_id: &str, ws_url: &str) -> WsProxySelection {
    if let Some(proxy_url) = crate::gateway::current_upstream_proxy_url_for_account(account_id)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return WsProxySelection {
            url: Some(proxy_url),
            source: "configured",
        };
    }
    if let Some(proxy_url) = websocket_env_proxy_url(ws_url) {
        return WsProxySelection {
            url: Some(proxy_url),
            source: "environment",
        };
    }
    if let Some(proxy_url) = websocket_system_proxy_url(ws_url) {
        return WsProxySelection {
            url: Some(proxy_url),
            source: "system",
        };
    }
    WsProxySelection {
        url: None,
        source: "direct",
    }
}

fn websocket_env_proxy_url(ws_url: &str) -> Option<String> {
    if websocket_no_proxy_matches(ws_url) {
        log::info!(
            "event=responses_ws_proxy_env_bypassed upstream_url={} reason=no_proxy",
            ws_url
        );
        return None;
    }
    [
        "HTTPS_PROXY",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
        "HTTP_PROXY",
        "http_proxy",
    ]
    .into_iter()
    .find_map(env_proxy_value)
}

fn env_proxy_value(name: &str) -> Option<String> {
    let value = env_text_value(name)?;
    let normalized = normalize_websocket_proxy_url(value.as_str());
    if normalized.is_none() {
        log::warn!(
            "event=responses_ws_env_proxy_ignored var={} proxy={} reason=unsupported_or_invalid",
            name,
            sanitize_proxy_url_for_log(value.as_str())
        );
    }
    normalized
}

fn env_text_value(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn websocket_no_proxy_matches(ws_url: &str) -> bool {
    let Some(target_host) = url::Url::parse(ws_url)
        .ok()
        .and_then(|url| url.host_str().map(|host| host.to_ascii_lowercase()))
    else {
        return false;
    };
    let Some(no_proxy) = env_text_value("NO_PROXY").or_else(|| env_text_value("no_proxy")) else {
        return false;
    };
    no_proxy
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .any(|pattern| {
            if pattern == "*" {
                return true;
            }
            let normalized = pattern
                .trim_start_matches('.')
                .split(':')
                .next()
                .unwrap_or(pattern)
                .to_ascii_lowercase();
            target_host == normalized || target_host.ends_with(&format!(".{normalized}"))
        })
}

fn normalize_websocket_proxy_url(proxy_url: &str) -> Option<String> {
    let value = rewrite_websocket_proxy_url(proxy_url);
    let Ok(parsed) = url::Url::parse(value.as_str()) else {
        return None;
    };
    match parsed.scheme() {
        "http" | "socks" | "socks5" | "socks5h" => Some(value),
        _ => None,
    }
}

fn rewrite_websocket_proxy_url(proxy_url: &str) -> String {
    let mut normalized = proxy_url.trim().to_string();
    if normalized.is_empty() {
        return normalized;
    }
    if let Some(rest) = normalized.strip_prefix("http://socks") {
        normalized = format!("socks{rest}");
    } else if let Some(rest) = normalized.strip_prefix("https://socks") {
        normalized = format!("socks{rest}");
    }
    if normalized.starts_with("socks5://") {
        normalized = normalized.replacen("socks5://", "socks5h://", 1);
    } else if normalized.starts_with("socks://") {
        normalized = normalized.replacen("socks://", "socks5h://", 1);
    } else if !normalized.contains("://") {
        normalized = format!("http://{normalized}");
    }
    normalized
}

#[cfg(windows)]
fn websocket_system_proxy_url(ws_url: &str) -> Option<String> {
    let settings = match windows_registry::CURRENT_USER
        .open("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
    {
        Ok(settings) => settings,
        Err(err) => {
            log::debug!(
                "event=responses_ws_system_proxy_unavailable reason=open_registry_failed err={}",
                err
            );
            return None;
        }
    };

    let enabled = settings.get_u32("ProxyEnable").unwrap_or(0);
    if enabled == 0 {
        log::debug!("event=responses_ws_system_proxy_ignored reason=proxy_disabled");
        return None;
    }

    let proxy_override = settings.get_string("ProxyOverride").ok();
    if websocket_proxy_override_matches(ws_url, proxy_override.as_deref()) {
        log::info!(
            "event=responses_ws_system_proxy_ignored reason=override_match upstream_url={}",
            ws_url
        );
        return None;
    }

    let raw_proxy = match settings.get_string("ProxyServer") {
        Ok(value) => value,
        Err(err) => {
            log::debug!(
                "event=responses_ws_system_proxy_unavailable reason=read_proxy_server_failed err={}",
                err
            );
            return None;
        }
    };
    let Some(proxy_url) = parse_windows_proxy_server(ws_url, raw_proxy.as_str()) else {
        log::warn!(
            "event=responses_ws_system_proxy_ignored reason=empty_proxy_server raw={}",
            raw_proxy
        );
        return None;
    };
    let normalized = normalize_websocket_proxy_url(proxy_url.as_str());
    if let Some(value) = normalized {
        log::info!(
            "event=responses_ws_system_proxy_selected proxy={}",
            sanitize_proxy_url_for_log(value.as_str())
        );
        return Some(value);
    }

    log::warn!(
        "event=responses_ws_system_proxy_ignored reason=unsupported_or_invalid proxy={}",
        sanitize_proxy_url_for_log(proxy_url.as_str())
    );
    None
}

#[cfg(not(windows))]
fn websocket_system_proxy_url(_ws_url: &str) -> Option<String> {
    None
}

#[cfg(windows)]
fn parse_windows_proxy_server(ws_url: &str, proxy_server: &str) -> Option<String> {
    let raw = proxy_server.trim();
    if raw.is_empty() {
        return None;
    }
    if !raw.contains('=') {
        return Some(raw.to_string());
    }

    let target_scheme = url::Url::parse(ws_url)
        .ok()
        .map(|url| url.scheme().to_ascii_lowercase())
        .unwrap_or_else(|| "wss".to_string());
    let preferred_key = if target_scheme == "ws" {
        "http"
    } else {
        "https"
    };
    let mut preferred = None;
    let mut http = None;
    let mut socks = None;

    for part in raw
        .split(';')
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        let Some((key, value)) = part.split_once('=') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        let candidate = windows_proxy_entry_to_url(key.as_str(), value);
        if key == preferred_key {
            preferred = Some(candidate);
        } else if key == "http" {
            http = Some(candidate);
        } else if matches!(key.as_str(), "socks" | "socks4" | "socks5") {
            socks = Some(candidate);
        }
    }

    preferred.or(http).or(socks)
}

#[cfg(windows)]
fn windows_proxy_entry_to_url(key: &str, value: &str) -> String {
    if value.contains("://") {
        return value.to_string();
    }
    if matches!(key, "socks" | "socks4" | "socks5") {
        format!("socks5h://{value}")
    } else {
        format!("http://{value}")
    }
}

fn websocket_proxy_override_matches(ws_url: &str, override_list: Option<&str>) -> bool {
    let Some(raw) = override_list
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    let Some(target_host) = websocket_target_host(ws_url) else {
        return false;
    };
    raw.split(';')
        .map(str::trim)
        .filter(|pattern| !pattern.is_empty())
        .any(|pattern| websocket_proxy_override_pattern_matches(&target_host, pattern))
}

fn websocket_target_host(ws_url: &str) -> Option<String> {
    url::Url::parse(ws_url)
        .ok()
        .and_then(|url| url.host_str().map(|host| host.to_ascii_lowercase()))
}

fn websocket_proxy_override_pattern_matches(target_host: &str, pattern: &str) -> bool {
    let pattern = pattern.trim().to_ascii_lowercase();
    if pattern == "*" {
        return true;
    }
    if pattern == "<local>" {
        return !target_host.contains('.') || is_local_proxy_host(target_host);
    }
    let normalized = pattern
        .trim_start_matches('.')
        .split(':')
        .next()
        .unwrap_or(pattern.as_str());
    if normalized.contains('*') {
        return wildcard_ascii_match(normalized, target_host);
    }
    target_host == normalized || target_host.ends_with(&format!(".{normalized}"))
}

fn wildcard_ascii_match(pattern: &str, value: &str) -> bool {
    let pattern_parts: Vec<&str> = pattern.split('*').collect();
    if pattern_parts.len() == 1 {
        return pattern == value;
    }

    let mut remaining = value;
    for (index, part) in pattern_parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        let Some(position) = remaining.find(part) else {
            return false;
        };
        if index == 0 && !pattern.starts_with('*') && position != 0 {
            return false;
        }
        remaining = &remaining[position + part.len()..];
    }
    if !pattern.ends_with('*') {
        if let Some(last) = pattern_parts.iter().rev().find(|part| !part.is_empty()) {
            return value.ends_with(last);
        }
    }
    true
}

fn is_local_proxy_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1")
        || host.starts_with("127.")
        || host.eq_ignore_ascii_case("[::1]")
}

fn sanitize_proxy_url_for_log(proxy_url: &str) -> String {
    let Ok(mut url) = url::Url::parse(proxy_url) else {
        return "<invalid-proxy-url>".to_string();
    };
    if !url.username().is_empty() {
        let _ = url.set_username("***");
    }
    if url.password().is_some() {
        let _ = url.set_password(Some("***"));
    }
    url.to_string()
}

fn websocket_connect_timeout() -> Duration {
    let timeout = crate::gateway::current_upstream_connect_timeout();
    if timeout.is_zero() {
        Duration::from_secs(15)
    } else {
        timeout
    }
}

async fn with_websocket_connect_timeout<T, F>(
    operation: &str,
    timeout: Duration,
    future: F,
) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    match tokio::time::timeout(timeout, future).await {
        Ok(result) => result,
        Err(_) => Err(format!(
            "{operation} timed out after {} ms",
            timeout.as_millis()
        )),
    }
}

async fn connect_upstream_websocket_request(
    request: WsClientRequest,
    ws_url: &str,
    proxy_url: Option<&str>,
) -> Result<
    (
        tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>,
        WsClientResponse,
    ),
    String,
> {
    let timeout = websocket_connect_timeout();
    let Some(proxy_url) = proxy_url.map(str::trim).filter(|value| !value.is_empty()) else {
        return with_websocket_connect_timeout(
            "connect direct upstream websocket",
            timeout,
            async move {
                connect_async_tls_with_config(request, None, false, None)
                    .await
                    .map_err(|err| format!("connect direct upstream websocket failed: {err}"))
            },
        )
        .await;
    };

    let stream = with_websocket_connect_timeout(
        "connect websocket proxy tunnel",
        timeout,
        connect_websocket_proxy_tcp(ws_url, proxy_url),
    )
    .await?;
    with_websocket_connect_timeout(
        "handshake upstream websocket through proxy",
        timeout,
        async move {
            client_async_tls_with_config(request, stream, None, None)
                .await
                .map_err(|err| format!("handshake upstream websocket through proxy failed: {err}"))
        },
    )
    .await
}

async fn connect_websocket_proxy_tcp(ws_url: &str, proxy_url: &str) -> Result<TcpStream, String> {
    let target = parse_websocket_target(ws_url)?;
    let proxy = url::Url::parse(proxy_url)
        .map_err(|err| format!("invalid websocket proxy url {proxy_url}: {err}"))?;
    match proxy.scheme() {
        "http" => connect_http_proxy_tunnel(&proxy, &target).await,
        "socks" | "socks5" | "socks5h" => connect_socks5_proxy_tunnel(&proxy, &target).await,
        other => Err(format!("unsupported websocket proxy scheme: {other}")),
    }
}

fn parse_websocket_target(ws_url: &str) -> Result<WebsocketTarget, String> {
    let url = url::Url::parse(ws_url).map_err(|err| format!("invalid websocket url: {err}"))?;
    let raw_host = url
        .host_str()
        .map(str::to_string)
        .ok_or_else(|| "websocket url missing host".to_string())?;
    let host = raw_host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(raw_host.as_str())
        .to_string();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "websocket url missing port".to_string())?;
    let authority_host = authority_host(host.as_str());
    Ok(WebsocketTarget {
        host,
        port,
        authority: format!("{authority_host}:{port}"),
    })
}

fn proxy_host_port(proxy: &url::Url) -> Result<(String, u16), String> {
    let host = proxy
        .host_str()
        .map(str::to_string)
        .ok_or_else(|| "websocket proxy url missing host".to_string())?;
    let port = proxy
        .port_or_known_default()
        .unwrap_or(match proxy.scheme() {
            "http" => 80,
            "socks" | "socks5" | "socks5h" => 1080,
            _ => 0,
        });
    if port == 0 {
        return Err("websocket proxy url missing port".to_string());
    }
    Ok((host, port))
}

fn authority_host(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    }
}

async fn connect_http_proxy_tunnel(
    proxy: &url::Url,
    target: &WebsocketTarget,
) -> Result<TcpStream, String> {
    let (proxy_host, proxy_port) = proxy_host_port(proxy)?;
    let mut stream = TcpStream::connect((proxy_host.as_str(), proxy_port))
        .await
        .map_err(|err| format!("connect websocket http proxy failed: {err}"))?;

    let mut request = format!(
        "CONNECT {0} HTTP/1.1\r\nHost: {0}\r\nProxy-Connection: Keep-Alive\r\n",
        target.authority
    );
    if let Some(header) = proxy_basic_auth_header(proxy)? {
        request.push_str("Proxy-Authorization: ");
        request.push_str(header.as_str());
        request.push_str("\r\n");
    }
    request.push_str("\r\n");

    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|err| format!("write websocket http proxy CONNECT failed: {err}"))?;

    let mut response = Vec::new();
    let mut buffer = [0_u8; 1024];
    while response.len() < 8192 {
        let read = stream
            .read(&mut buffer)
            .await
            .map_err(|err| format!("read websocket http proxy CONNECT failed: {err}"))?;
        if read == 0 {
            return Err("websocket http proxy closed before CONNECT response".to_string());
        }
        response.extend_from_slice(&buffer[..read]);
        if response.windows(4).any(|window| window == b"\r\n\r\n") {
            let text = String::from_utf8_lossy(response.as_slice());
            let status = text.lines().next().unwrap_or_default();
            if status.split_whitespace().nth(1) == Some("200") {
                return Ok(stream);
            }
            return Err(format!("websocket http proxy CONNECT rejected: {status}"));
        }
    }
    Err("websocket http proxy CONNECT response too large".to_string())
}

fn proxy_basic_auth_header(proxy: &url::Url) -> Result<Option<String>, String> {
    if proxy.username().is_empty() {
        return Ok(None);
    }
    let mut credentials = proxy.username().to_string();
    if let Some(password) = proxy.password() {
        credentials.push(':');
        credentials.push_str(password);
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(credentials.as_bytes());
    Ok(Some(format!("Basic {encoded}")))
}

async fn connect_socks5_proxy_tunnel(
    proxy: &url::Url,
    target: &WebsocketTarget,
) -> Result<TcpStream, String> {
    let (proxy_host, proxy_port) = proxy_host_port(proxy)?;
    let mut stream = TcpStream::connect((proxy_host.as_str(), proxy_port))
        .await
        .map_err(|err| format!("connect websocket socks5 proxy failed: {err}"))?;

    let username = proxy.username();
    let password = proxy.password().unwrap_or("");
    if username.is_empty() {
        stream
            .write_all(&[0x05, 0x01, 0x00])
            .await
            .map_err(|err| format!("write socks5 greeting failed: {err}"))?;
    } else {
        stream
            .write_all(&[0x05, 0x02, 0x00, 0x02])
            .await
            .map_err(|err| format!("write socks5 greeting failed: {err}"))?;
    }

    let mut method = [0_u8; 2];
    stream
        .read_exact(&mut method)
        .await
        .map_err(|err| format!("read socks5 method failed: {err}"))?;
    if method[0] != 0x05 {
        return Err("invalid socks5 greeting response".to_string());
    }
    match method[1] {
        0x00 => {}
        0x02 => authenticate_socks5_proxy(&mut stream, username, password).await?,
        0xff => return Err("socks5 proxy rejected supported auth methods".to_string()),
        other => return Err(format!("unsupported socks5 auth method: {other}")),
    }

    let request = build_socks5_connect_request(target)?;
    stream
        .write_all(request.as_slice())
        .await
        .map_err(|err| format!("write socks5 connect request failed: {err}"))?;

    let mut head = [0_u8; 4];
    stream
        .read_exact(&mut head)
        .await
        .map_err(|err| format!("read socks5 connect response failed: {err}"))?;
    if head[0] != 0x05 {
        return Err("invalid socks5 connect response".to_string());
    }
    if head[1] != 0x00 {
        return Err(format!("socks5 connect rejected with code {}", head[1]));
    }
    match head[3] {
        0x01 => read_exact_discard(&mut stream, 4).await?,
        0x03 => {
            let mut len = [0_u8; 1];
            stream
                .read_exact(&mut len)
                .await
                .map_err(|err| format!("read socks5 bound domain length failed: {err}"))?;
            read_exact_discard(&mut stream, len[0] as usize).await?;
        }
        0x04 => read_exact_discard(&mut stream, 16).await?,
        other => {
            return Err(format!(
                "unsupported socks5 address type in response: {other}"
            ))
        }
    }
    read_exact_discard(&mut stream, 2).await?;
    Ok(stream)
}

async fn authenticate_socks5_proxy(
    stream: &mut TcpStream,
    username: &str,
    password: &str,
) -> Result<(), String> {
    if username.len() > u8::MAX as usize || password.len() > u8::MAX as usize {
        return Err("socks5 proxy username/password is too long".to_string());
    }
    let mut request = Vec::with_capacity(3 + username.len() + password.len());
    request.push(0x01);
    request.push(username.len() as u8);
    request.extend_from_slice(username.as_bytes());
    request.push(password.len() as u8);
    request.extend_from_slice(password.as_bytes());
    stream
        .write_all(request.as_slice())
        .await
        .map_err(|err| format!("write socks5 auth failed: {err}"))?;
    let mut response = [0_u8; 2];
    stream
        .read_exact(&mut response)
        .await
        .map_err(|err| format!("read socks5 auth failed: {err}"))?;
    if response[1] == 0x00 {
        Ok(())
    } else {
        Err(format!("socks5 auth rejected with code {}", response[1]))
    }
}

fn build_socks5_connect_request(target: &WebsocketTarget) -> Result<Vec<u8>, String> {
    let mut request = vec![0x05, 0x01, 0x00];
    if let Ok(ip) = target.host.parse::<IpAddr>() {
        match ip {
            IpAddr::V4(addr) => {
                request.push(0x01);
                request.extend_from_slice(&addr.octets());
            }
            IpAddr::V6(addr) => {
                request.push(0x04);
                request.extend_from_slice(&addr.octets());
            }
        }
    } else {
        let host = target.host.as_bytes();
        if host.len() > u8::MAX as usize {
            return Err("websocket target host is too long for socks5".to_string());
        }
        request.push(0x03);
        request.push(host.len() as u8);
        request.extend_from_slice(host);
    }
    request.extend_from_slice(&target.port.to_be_bytes());
    Ok(request)
}

async fn read_exact_discard(stream: &mut TcpStream, len: usize) -> Result<(), String> {
    let mut buffer = vec![0_u8; len];
    stream
        .read_exact(buffer.as_mut_slice())
        .await
        .map_err(|err| format!("read socks5 response body failed: {err}"))?;
    Ok(())
}

fn build_upstream_websocket_request(
    ws_url: &str,
    account: &codexmanager_core::storage::Account,
    bearer_token: &str,
    context: &WsRequestContext,
) -> Result<tokio_tungstenite::tungstenite::handshake::client::Request, WsSessionError> {
    let mut request = ws_url.into_client_request().map_err(|err| {
        WsSessionError::bad_gateway_bilingual(
            "构建上游 WebSocket 请求失败",
            format!("build upstream websocket request failed: {err}"),
        )
    })?;
    let headers = request.headers_mut();
    if context.transparent_mode {
        let chatgpt_account_id = account
            .chatgpt_account_id
            .as_deref()
            .or(account.workspace_id.as_deref());
        for (name, value) in context
            .incoming_headers
            .transparent_upstream_headers(bearer_token, chatgpt_account_id)
        {
            append_header(headers, name.as_str(), value.as_str())?;
        }
        return Ok(request);
    }
    insert_header(headers, "Authorization", &format!("Bearer {bearer_token}"))?;
    if let Some(account_id) = account
        .chatgpt_account_id
        .as_deref()
        .or(account.workspace_id.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        insert_header(headers, "ChatGPT-Account-ID", account_id)?;
    }
    insert_header(
        headers,
        "User-Agent",
        &crate::gateway::current_codex_user_agent(),
    )?;
    insert_header(
        headers,
        "originator",
        &crate::gateway::current_wire_originator(),
    )?;
    if let Some(residency_requirement) = crate::gateway::current_residency_requirement() {
        insert_header(
            headers,
            "x-openai-internal-codex-residency",
            residency_requirement.as_str(),
        )?;
    }
    if let Some(session_id) = context.incoming_headers.session_id() {
        insert_header(headers, "session_id", session_id)?;
    }
    if let Some(window_id) = context.incoming_headers.window_id() {
        insert_header(
            headers,
            crate::http::codex_source::X_CODEX_WINDOW_ID_HEADER,
            window_id,
        )?;
    }
    if let Some(client_request_id) = context.incoming_headers.client_request_id() {
        insert_header(headers, "x-client-request-id", client_request_id)?;
    }
    if let Some(subagent) = context.incoming_headers.subagent() {
        insert_header(
            headers,
            crate::http::codex_source::X_OPENAI_SUBAGENT_HEADER,
            subagent,
        )?;
    }
    if let Some(beta_features) = context.incoming_headers.beta_features() {
        insert_header(headers, "x-codex-beta-features", beta_features)?;
    }
    if let Some(turn_state) = context.incoming_headers.turn_state() {
        insert_header(
            headers,
            crate::http::codex_source::X_CODEX_TURN_STATE_HEADER,
            turn_state,
        )?;
    }
    if let Some(turn_metadata) = context.incoming_headers.turn_metadata() {
        insert_header(
            headers,
            crate::http::codex_source::X_CODEX_TURN_METADATA_HEADER,
            turn_metadata,
        )?;
    }
    if let Some(parent_thread_id) = context.incoming_headers.parent_thread_id() {
        insert_header(
            headers,
            crate::http::codex_source::X_CODEX_PARENT_THREAD_ID_HEADER,
            parent_thread_id,
        )?;
    }
    if let Some(include_timing_metrics) = context
        .incoming_headers
        .responsesapi_include_timing_metrics()
    {
        insert_header(
            headers,
            crate::http::codex_source::X_RESPONSESAPI_INCLUDE_TIMING_METRICS_HEADER,
            include_timing_metrics,
        )?;
    }
    Ok(request)
}

fn begin_ws_request_log(
    context: &WsRequestContext,
    prepared: &PreparedClientFrame,
) -> PendingWsRequestLog {
    let trace_id = crate::gateway::next_trace_id();
    let effective_protocol_type = crate::apikey_profile::resolve_gateway_protocol_type(
        context.api_key.protocol_type.as_str(),
        RESPONSES_ENDPOINT,
    );
    crate::gateway::log_request_start(
        trace_id.as_str(),
        context.api_key.id.as_str(),
        "GET",
        RESPONSES_ENDPOINT,
        prepared.model.as_deref(),
        prepared.reasoning_effort.as_deref(),
        prepared.service_tier.as_deref(),
        true,
        "ws",
        effective_protocol_type,
    );
    crate::gateway::log_client_service_tier(
        trace_id.as_str(),
        "ws",
        RESPONSES_ENDPOINT,
        prepared.has_service_tier_field,
        prepared.raw_service_tier.as_deref(),
        prepared.service_tier.as_deref(),
    );
    let (frame_kind, frame_len, frame_sha256_16) = if prepared.text.is_empty() {
        let frame_len = match &prepared.upstream_message {
            UpstreamMessage::Binary(bytes) => bytes.len(),
            _ => 0,
        };
        ("binary", frame_len, "-".to_string())
    } else {
        (
            "text",
            prepared.text.len(),
            websocket_text_sha256_16(prepared.text.as_str()),
        )
    };
    log::info!(
        "event=responses_ws_client_frame_prepared trace_id={} api_key_id={} transparent_mode={} frame_kind={} frame_len={} frame_sha256_16={}",
        trace_id,
        context.api_key.id,
        context.transparent_mode,
        frame_kind,
        frame_len,
        frame_sha256_16
    );
    PendingWsRequestLog {
        trace_id,
        model: prepared.model.clone(),
        reasoning_effort: prepared.reasoning_effort.clone(),
        service_tier: prepared.service_tier.clone(),
        effective_service_tier: prepared.effective_service_tier.clone(),
        started_at: Instant::now(),
        first_response_ms: None,
        output_text: String::new(),
    }
}

fn mark_ws_first_response(pending: &mut PendingWsRequestState) {
    if pending.log.first_response_ms.is_none() {
        pending.log.first_response_ms = Some(
            pending
                .log
                .started_at
                .elapsed()
                .as_millis()
                .min(i64::MAX as u128) as i64,
        );
    }
    pending.forwarded_upstream_event = true;
}

fn finalize_ws_request_log(
    context: &WsRequestContext,
    pending: &PendingWsRequestLog,
    account_id: Option<&str>,
    upstream_url: Option<&str>,
    status_code: u16,
    mut usage: crate::gateway::RequestLogUsage,
    error: Option<String>,
) {
    let Some(storage) = open_storage() else {
        return;
    };
    if usage.first_response_ms.is_none() {
        usage.first_response_ms = pending.first_response_ms;
    }
    let output_text = pending.output_text.trim();
    if !output_text.is_empty() {
        usage.output_text = Some(output_text.to_string());
    }
    crate::gateway::write_request_log(
        &storage,
        crate::gateway::RequestLogTraceContext {
            trace_id: Some(pending.trace_id.as_str()),
            original_path: Some(RESPONSES_ENDPOINT),
            adapted_path: Some(RESPONSES_ENDPOINT),
            request_type: Some("ws"),
            service_tier: pending.service_tier.as_deref(),
            effective_service_tier: pending.effective_service_tier.as_deref(),
            transparent_mode: Some(context.transparent_mode),
            ..Default::default()
        },
        Some(context.api_key.id.as_str()),
        account_id,
        RESPONSES_ENDPOINT,
        "GET",
        pending.model.as_deref(),
        pending.reasoning_effort.as_deref(),
        upstream_url,
        Some(status_code),
        usage,
        error.as_deref(),
        Some(pending.started_at.elapsed().as_millis()),
    );
    crate::gateway::log_request_final(
        pending.trace_id.as_str(),
        status_code,
        account_id,
        upstream_url,
        error.as_deref(),
        pending.started_at.elapsed().as_millis(),
    );
}

struct WsTerminalEvent {
    status_code: u16,
    event_type: String,
    error_code: Option<String>,
    error_param: Option<String>,
    usage: crate::gateway::RequestLogUsage,
    error: Option<String>,
}

fn should_rotate_ws_upstream(status_code: u16) -> bool {
    matches!(status_code, 401 | 403 | 404 | 408 | 409 | 429)
}

fn log_ws_terminal_diagnostic(
    context: &WsRequestContext,
    upstream: &ConnectedUpstreamWebsocket,
    pending: &PendingWsRequestState,
    terminal: &WsTerminalEvent,
    action: &str,
) {
    let diagnostics = ws_frame_diagnostics(pending.prepared.text.as_str());
    let error_fp = fingerprint_or_dash(terminal.error.as_deref());
    let error_previous_response_id_fp =
        fingerprint_or_dash(extract_previous_response_id_from_error(terminal.error.as_deref()));
    let previous_response_not_found = is_previous_response_not_found_terminal(terminal);
    let message = format!(
        "event=responses_ws_terminal_diagnostic trace_id={} action={} api_key_id={} account_id={} transparent_mode={} status={} terminal_type={} error_code={} error_param={} error_fp={} error_previous_response_id_fp={} previous_response_not_found={} request_type={} model={} previous_response_id_present={} previous_response_id_fp={} response_id_fp={} turn_state_present={} turn_state_fp={} thread_id_fp={} session_id_fp={} client_request_id_fp={} frame_sha256_16={} upstream_url={}",
        pending.log.trace_id.as_str(),
        action,
        context.api_key.id.as_str(),
        upstream.account_id.as_str(),
        context.transparent_mode,
        terminal.status_code,
        terminal.event_type.as_str(),
        terminal.error_code.as_deref().unwrap_or("-"),
        terminal.error_param.as_deref().unwrap_or("-"),
        error_fp.as_str(),
        error_previous_response_id_fp.as_str(),
        previous_response_not_found,
        diagnostics.request_type.as_str(),
        pending.prepared.model.as_deref().unwrap_or("-"),
        diagnostics.previous_response_id_present,
        diagnostics.previous_response_id_fp.as_str(),
        diagnostics.response_id_fp.as_str(),
        context.incoming_headers.turn_state().is_some(),
        fingerprint_or_dash(context.incoming_headers.turn_state()),
        fingerprint_or_dash(context.incoming_headers.thread_id()),
        fingerprint_or_dash(context.incoming_headers.session_id()),
        fingerprint_or_dash(context.incoming_headers.client_request_id()),
        websocket_text_sha256_16(pending.prepared.text.as_str()),
        upstream.upstream_url.as_str()
    );
    if terminal.status_code >= 400 {
        log::warn!("{}", message);
    } else {
        log::info!("{}", message);
    }
}

async fn try_retry_ws_request_after_terminal(
    context: &WsRequestContext,
    upstream: &mut ConnectedUpstreamWebsocket,
    pending: &mut PendingWsRequestState,
    terminal: &WsTerminalEvent,
) -> bool {
    if terminal.status_code == 200 || pending.forwarded_upstream_event {
        return false;
    }
    if pending.prepared.text.is_empty() {
        return false;
    }
    let mut retry_text = None;
    if is_websocket_connection_limit_terminal(terminal) {
        if !try_reconnect_ws_upstream_after_connection_limit(
            context,
            upstream,
            terminal.status_code,
        )
        .await
        {
            return false;
        }
        log_ws_terminal_diagnostic(
            context,
            upstream,
            pending,
            terminal,
            "connection_limit_reconnected",
        );
    } else if context.transparent_mode {
        log_ws_terminal_diagnostic(
            context,
            upstream,
            pending,
            terminal,
            "transparent_passthrough_no_retry",
        );
        return false;
    } else if is_previous_response_not_found_terminal(terminal) {
        retry_text = strip_previous_response_id_from_ws_text(pending.prepared.text.as_str());
        if retry_text.is_none() {
            return false;
        }
    } else {
        let previous_account_id = upstream.account_id.clone();
        if !try_rotate_ws_upstream_after_terminal(
            context,
            upstream,
            pending.prepared.model.as_deref(),
            terminal.status_code,
        )
        .await
        {
            return false;
        }
        if upstream.account_id != previous_account_id {
            retry_text = strip_previous_response_id_from_ws_text(pending.prepared.text.as_str());
        }
    }
    let retry_text = retry_text.unwrap_or_else(|| pending.prepared.text.clone());
    match upstream
        .stream
        .send(UpstreamMessage::Text(retry_text.clone().into()))
        .await
    {
        Ok(()) => {
            pending.prepared.upstream_message = UpstreamMessage::Text(retry_text.clone().into());
            pending.prepared.text = retry_text;
            pending.forwarded_upstream_event = false;
            pending.log.first_response_ms = None;
            true
        }
        Err(err) => {
            log::warn!(
                "event=responses_ws_retry_send_failed account_id={} status={} err={}",
                upstream.account_id,
                terminal.status_code,
                err
            );
            false
        }
    }
}

async fn try_reconnect_ws_upstream_after_connection_limit(
    context: &WsRequestContext,
    upstream: &mut ConnectedUpstreamWebsocket,
    status_code: u16,
) -> bool {
    let current_account_id = upstream.account_id.clone();
    let (mut account, token) =
        match load_ws_reconnect_account_and_token(current_account_id.as_str()) {
            Ok(value) => value,
            Err(err) => {
                log::warn!(
                    "event=responses_ws_connection_limit_load_account_failed account_id={} status={} err={}",
                    current_account_id,
                    status_code,
                    err
                );
                return false;
            }
        };

    let (chatgpt_account_id, workspace_id) =
        crate::usage_account_meta::derive_account_meta(&token);
    if crate::usage_account_meta::patch_account_meta_in_place(
        &mut account,
        chatgpt_account_id,
        workspace_id,
    ) {
        account.updated_at = codexmanager_core::storage::now_ts();
        if let Some(storage) = open_storage() {
            let _ = storage.insert_account(&account);
        }
    }

    let bearer = match resolve_bearer_token_for_websocket(account.clone(), token).await {
        Ok(token) => token,
        Err(err) => {
            log::warn!(
                "event=responses_ws_connection_limit_bearer_failed account_id={} status={} err={}",
                current_account_id,
                status_code,
                err
            );
            return false;
        }
    };
    let request = match build_upstream_websocket_request(
        upstream.upstream_url.as_str(),
        &account,
        bearer.as_str(),
        context,
    ) {
        Ok(request) => request,
        Err(err) => {
            log::warn!(
                "event=responses_ws_connection_limit_request_failed account_id={} status={} err={}",
                current_account_id,
                status_code,
                err.message
            );
            return false;
        }
    };

    ensure_rustls_crypto_provider();
    let replacement = match connect_upstream_websocket_for_account(
        request,
        upstream.upstream_url.as_str(),
        &account,
        context,
    )
    .await
    {
        Ok((stream, _)) => ConnectedUpstreamWebsocket {
            stream,
            account_id: account.id,
            upstream_url: upstream.upstream_url.clone(),
        },
        Err(err) => {
            log::warn!(
                "event=responses_ws_connection_limit_reconnect_failed account_id={} status={} err={}",
                current_account_id,
                status_code,
                err
            );
            return false;
        }
    };

    let _ = upstream.stream.close(None).await;
    *upstream = replacement;
    true
}

fn load_ws_reconnect_account_and_token(
    account_id: &str,
) -> Result<
    (
        codexmanager_core::storage::Account,
        codexmanager_core::storage::Token,
    ),
    String,
> {
    let storage = open_storage()
        .ok_or_else(|| crate::gateway::bilingual_error("存储不可用", "storage unavailable"))?;
    let account = storage
        .find_account_by_id(account_id)
        .map_err(|err| format!("load websocket reconnect account failed: {err}"))?
        .ok_or_else(|| "websocket reconnect account not found".to_string())?;
    let token = storage
        .find_token_by_account_id(account_id)
        .map_err(|err| format!("load websocket reconnect token failed: {err}"))?
        .ok_or_else(|| "websocket reconnect token not found".to_string())?;
    Ok((account, token))
}

async fn try_rotate_ws_upstream_after_terminal(
    context: &WsRequestContext,
    upstream: &mut ConnectedUpstreamWebsocket,
    model: Option<&str>,
    status_code: u16,
) -> bool {
    if !should_rotate_ws_upstream(status_code) {
        return false;
    }

    let current_account_id = upstream.account_id.clone();
    crate::gateway::gateway_mark_account_cooldown_for_status(
        current_account_id.as_str(),
        status_code,
    );
    if status_code == 429 {
        let _ =
            crate::usage_refresh::enqueue_usage_refresh_for_account(current_account_id.as_str());
    }

    let storage = match open_storage() {
        Some(storage) => storage,
        None => return false,
    };
    let candidates = match crate::gateway::gateway_collect_routed_candidates(
        &storage,
        &context.api_key.id,
        model,
    ) {
        Ok(candidates) => candidates,
        Err(err) => {
            log::warn!(
                "event=responses_ws_failover_candidates_failed account_id={} status={} err={}",
                current_account_id,
                status_code,
                err
            );
            return false;
        }
    };
    let Some((account, token)) = candidates
        .into_iter()
        .find(|(account, _)| account.id != current_account_id)
    else {
        return false;
    };

    let bearer = match resolve_bearer_token_for_websocket(account.clone(), token).await {
        Ok(token) => token,
        Err(err) => {
            log::warn!(
                "event=responses_ws_failover_bearer_failed account_id={} next_account_id={} status={} err={}",
                current_account_id,
                account.id,
                status_code,
                err
            );
            return false;
        }
    };
    let request = match build_upstream_websocket_request(
        upstream.upstream_url.as_str(),
        &account,
        bearer.as_str(),
        context,
    ) {
        Ok(request) => request,
        Err(err) => {
            log::warn!(
                "event=responses_ws_failover_request_failed account_id={} next_account_id={} status={} err={}",
                current_account_id,
                account.id,
                status_code,
                err.message
            );
            return false;
        }
    };

    ensure_rustls_crypto_provider();
    let replacement = match connect_upstream_websocket_for_account(
        request,
        upstream.upstream_url.as_str(),
        &account,
        context,
    )
    .await
    {
        Ok((stream, _)) => ConnectedUpstreamWebsocket {
            stream,
            account_id: account.id,
            upstream_url: upstream.upstream_url.clone(),
        },
        Err(err) => {
            log::warn!(
                "event=responses_ws_failover_connect_failed account_id={} status={} err={}",
                current_account_id,
                status_code,
                err
            );
            return false;
        }
    };

    crate::gateway::gateway_record_failover_attempt();
    let _ = upstream.stream.close(None).await;
    *upstream = replacement;
    true
}

fn inspect_ws_terminal_event(text: &str) -> Option<WsTerminalEvent> {
    let value = serde_json::from_str::<Value>(text).ok()?;
    let event_type = value
        .get("type")
        .and_then(Value::as_str)?
        .trim()
        .to_ascii_lowercase();
    match event_type.as_str() {
        "response.completed" | "response.done" => Some(WsTerminalEvent {
            status_code: 200,
            event_type,
            error_code: None,
            error_param: None,
            usage: parse_ws_usage(&value),
            error: None,
        }),
        "response.failed" | "error" => {
            let error = extract_ws_error_message(&value);
            let error_code = extract_ws_error_string_field(&value, "code");
            let error_param = extract_ws_error_string_field(&value, "param");
            Some(WsTerminalEvent {
                status_code: infer_ws_terminal_status(&value, error.as_deref()),
                event_type,
                error_code,
                error_param,
                usage: parse_ws_usage(&value),
                error,
            })
        }
        _ => None,
    }
}

fn is_websocket_connection_limit_terminal(terminal: &WsTerminalEvent) -> bool {
    terminal
        .error_code
        .as_deref()
        .is_some_and(|code| code == WEBSOCKET_CONNECTION_LIMIT_REACHED_CODE)
}

fn is_previous_response_not_found_terminal(terminal: &WsTerminalEvent) -> bool {
    if terminal.status_code != 400 {
        return false;
    }
    let Some(error) = terminal.error.as_deref() else {
        return false;
    };
    let lower = error.to_ascii_lowercase();
    lower.contains("previous response") && lower.contains("not found")
}

fn strip_previous_response_id_from_ws_text(text: &str) -> Option<String> {
    let mut value = serde_json::from_str::<Value>(text).ok()?;
    let object = value.as_object_mut()?;
    if object
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|value| value == "response.create")
        && object.remove("previous_response_id").is_some()
    {
        return serde_json::to_string(&value).ok();
    }
    None
}

fn infer_ws_terminal_status(value: &Value, error_message: Option<&str>) -> u16 {
    if let Some(status_code) = value
        .get("status")
        .and_then(Value::as_u64)
        .and_then(|value| u16::try_from(value).ok())
    {
        return status_code;
    }
    if let Some(message) = error_message {
        if crate::account_status::usage_limit_reason_from_message(message).is_some() {
            return 429;
        }
        if crate::account_status::deactivation_reason_from_message(message).is_some() {
            return 403;
        }
    }
    502
}

fn collect_ws_output_text_from_frame(output: &mut String, text: &str) {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return;
    };
    let event_type = value
        .get("type")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    match event_type {
        "response.output_text.delta" => {
            if let Some(delta) = value.get("delta").and_then(Value::as_str) {
                output.push_str(delta);
            }
        }
        "response.output_text.done" => {
            if output.trim().is_empty() {
                if let Some(done_text) = value.get("text").and_then(Value::as_str) {
                    output.push_str(done_text);
                }
            }
        }
        "response.completed" | "response.done" | "response.output_item.done" => {
            if output.trim().is_empty() {
                if let Some(done_text) = extract_ws_output_text(&value) {
                    output.push_str(done_text.as_str());
                }
            }
        }
        _ => {}
    }
}

fn extract_ws_output_text(value: &Value) -> Option<String> {
    let mut output = String::new();
    if let Some(response) = value.get("response") {
        collect_ws_response_output_text(response, &mut output);
    } else {
        collect_ws_response_output_text(value, &mut output);
    }
    let trimmed = output.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn collect_ws_response_output_text(value: &Value, output: &mut String) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_ws_response_output_text(item, output);
            }
        }
        Value::Object(map) => {
            if let Some(text) = map.get("output_text").and_then(Value::as_str) {
                output.push_str(text);
                return;
            }
            if matches!(
                map.get("type").and_then(Value::as_str),
                Some("output_text" | "text")
            ) {
                if let Some(text) = map.get("text").and_then(Value::as_str) {
                    output.push_str(text);
                    return;
                }
            }
            if let Some(output_value) = map.get("output") {
                collect_ws_response_output_text(output_value, output);
            }
            if let Some(content) = map.get("content") {
                collect_ws_response_output_text(content, output);
            }
            if let Some(item) = map.get("item") {
                collect_ws_response_output_text(item, output);
            }
            if let Some(output_item) = map.get("output_item") {
                collect_ws_response_output_text(output_item, output);
            }
        }
        _ => {}
    }
}

fn parse_ws_usage(value: &Value) -> crate::gateway::RequestLogUsage {
    let top_usage = value.get("usage").and_then(Value::as_object);
    let response_usage = value
        .get("response")
        .and_then(|response| response.get("usage"))
        .and_then(Value::as_object);
    let usage = response_usage.or(top_usage);
    crate::gateway::RequestLogUsage {
        input_tokens: usage
            .and_then(|map| map.get("input_tokens"))
            .and_then(Value::as_i64)
            .or_else(|| {
                usage
                    .and_then(|map| map.get("prompt_tokens"))
                    .and_then(Value::as_i64)
            }),
        cached_input_tokens: usage
            .and_then(|map| map.get("input_tokens_details"))
            .and_then(|details| details.get("cached_tokens"))
            .and_then(Value::as_i64)
            .or_else(|| {
                usage
                    .and_then(|map| map.get("cached_input_tokens"))
                    .and_then(Value::as_i64)
            }),
        output_tokens: usage
            .and_then(|map| map.get("output_tokens"))
            .and_then(Value::as_i64)
            .or_else(|| {
                usage
                    .and_then(|map| map.get("completion_tokens"))
                    .and_then(Value::as_i64)
            }),
        total_tokens: usage
            .and_then(|map| map.get("total_tokens"))
            .and_then(Value::as_i64),
        reasoning_output_tokens: usage
            .and_then(|map| map.get("output_tokens_details"))
            .and_then(|details| details.get("reasoning_tokens"))
            .and_then(Value::as_i64)
            .or_else(|| {
                usage
                    .and_then(|map| map.get("reasoning_output_tokens"))
                    .and_then(Value::as_i64)
            }),
        first_response_ms: None,
        output_text: extract_ws_output_text(value),
    }
}

fn extract_ws_error_message(value: &Value) -> Option<String> {
    value
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(str::to_string)
        .or_else(|| {
            value
                .get("message")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|message| !message.is_empty())
                .map(str::to_string)
        })
}

fn extract_ws_error_string_field(value: &Value, field: &str) -> Option<String> {
    value
        .get("error")
        .and_then(|error| error.get(field))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            value
                .get(field)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
}

fn extract_previous_response_id_from_error(message: Option<&str>) -> Option<&str> {
    let message = message?;
    let marker = "Previous response with id '";
    let start = message.find(marker)? + marker.len();
    let tail = &message[start..];
    let end = tail.find('\'')?;
    Some(&tail[..end])
}

fn insert_header(headers: &mut HeaderMap, name: &str, value: &str) -> Result<(), WsSessionError> {
    let header_name = header::HeaderName::from_bytes(name.as_bytes()).map_err(|err| {
        WsSessionError::bad_gateway_bilingual(
            "上游 WebSocket 请求头名称无效",
            format!("invalid upstream websocket header name {name}: {err}"),
        )
    })?;
    let header_value = HeaderValue::from_str(value).map_err(|err| {
        WsSessionError::bad_gateway_bilingual(
            "上游 WebSocket 请求头值无效",
            format!("invalid upstream websocket header {name}: {err}"),
        )
    })?;
    headers.insert(header_name, header_value);
    Ok(())
}

fn append_header(headers: &mut HeaderMap, name: &str, value: &str) -> Result<(), WsSessionError> {
    let header_name = header::HeaderName::from_bytes(name.as_bytes()).map_err(|err| {
        WsSessionError::bad_gateway_bilingual(
            "上游 WebSocket 请求头名称无效",
            format!("invalid upstream websocket header name {name}: {err}"),
        )
    })?;
    let header_value = HeaderValue::from_str(value).map_err(|err| {
        WsSessionError::bad_gateway_bilingual(
            "上游 WebSocket 请求头值无效",
            format!("invalid upstream websocket header {name}: {err}"),
        )
    })?;
    headers.append(header_name, header_value);
    Ok(())
}

fn ensure_rustls_crypto_provider() {
    static RUSTLS_PROVIDER_READY: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    let _ = RUSTLS_PROVIDER_READY.get_or_init(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

async fn send_ws_error_and_close(
    socket: &mut WebSocket,
    err: WsSessionError,
    prefer_raw_errors: bool,
) {
    let message = crate::gateway::error_message_for_client(prefer_raw_errors, err.message);
    let payload = json!({
        "type": "error",
        "status": err.status,
        "error": {
            "code": err.code,
            "message": message,
        }
    });
    let _ = socket.send(Message::Text(payload.to_string().into())).await;
    let _ = socket.close().await;
}

fn upgrade_required_response(message: impl Into<String>) -> Response<Body> {
    let mut response = text_response(StatusCode::UPGRADE_REQUIRED, message.into());
    response
        .headers_mut()
        .insert(header::UPGRADE, HeaderValue::from_static("websocket"));
    response.headers_mut().insert(
        crate::error_codes::ERROR_CODE_HEADER_NAME,
        HeaderValue::from_static("upgrade_required"),
    );
    response
}

impl From<String> for WsSessionError {
    fn from(value: String) -> Self {
        WsSessionError::bad_gateway(value)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_socks5_connect_request, infer_ws_terminal_status, inspect_ws_terminal_event,
        is_previous_response_not_found_terminal, is_websocket_connection_limit_terminal,
        merge_client_metadata, parse_websocket_target, prepare_initial_client_frame,
        proxy_basic_auth_header, rewrite_client_frame, strip_previous_response_id_from_ws_text,
        WsRequestContext,
    };
    use axum::extract::ws::Message;
    use axum::http::{HeaderMap, HeaderValue};
    use codexmanager_core::storage::ApiKey;
    use serde_json::json;
    use tokio_tungstenite::tungstenite::Message as UpstreamMessage;

    fn sample_api_key() -> ApiKey {
        ApiKey {
            id: "gk_test".to_string(),
            name: Some("test".to_string()),
            model_slug: None,
            reasoning_effort: None,
            service_tier: None,
            client_type: "codex".to_string(),
            protocol_type: crate::apikey_profile::PROTOCOL_OPENAI_COMPAT.to_string(),
            auth_scheme: "authorization_bearer".to_string(),
            upstream_base_url: Some("https://chatgpt.com/backend-api/codex".to_string()),
            static_headers_json: None,
            key_hash: "hash".to_string(),
            status: "active".to_string(),
            created_at: 0,
            last_used_at: None,
            rotation_strategy: crate::apikey_profile::ROTATION_ACCOUNT.to_string(),
            aggregate_api_id: None,
            aggregate_api_url: None,
            account_plan_filter: None,
        }
    }

    fn sample_incoming_headers(
        conversation_id: Option<&str>,
        turn_state: Option<&str>,
    ) -> crate::gateway::IncomingHeaderSnapshot {
        let mut headers = HeaderMap::new();
        if let Some(conversation_id) = conversation_id {
            headers.insert(
                "conversation_id",
                HeaderValue::from_str(conversation_id).expect("conversation header"),
            );
        }
        if let Some(turn_state) = turn_state {
            headers.insert(
                "x-codex-turn-state",
                HeaderValue::from_str(turn_state).expect("turn-state header"),
            );
        }
        crate::gateway::IncomingHeaderSnapshot::from_http_headers(&headers)
    }

    fn sample_incoming_headers_with_metadata() -> crate::gateway::IncomingHeaderSnapshot {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-codex-turn-metadata",
            HeaderValue::from_static("turn-meta-1"),
        );
        headers.insert("x-codex-window-id", HeaderValue::from_static("window-1:0"));
        headers.insert("x-openai-subagent", HeaderValue::from_static("review"));
        headers.insert(
            "x-codex-parent-thread-id",
            HeaderValue::from_static("parent-thread-1"),
        );
        crate::gateway::IncomingHeaderSnapshot::from_http_headers(&headers)
    }

    #[test]
    fn websocket_target_authority_brackets_ipv6_host() {
        let target = parse_websocket_target("wss://[::1]/backend-api/codex/v1/responses")
            .expect("parse websocket target");

        assert_eq!(target.host, "::1");
        assert_eq!(target.port, 443);
        assert_eq!(target.authority, "[::1]:443");
    }

    #[test]
    fn socks5_connect_request_uses_domain_target() {
        let target = parse_websocket_target("wss://chatgpt.com/backend-api/codex/v1/responses")
            .expect("parse websocket target");
        let request = build_socks5_connect_request(&target).expect("build socks request");

        assert_eq!(
            request,
            vec![
                0x05, 0x01, 0x00, 0x03, 11, b'c', b'h', b'a', b't', b'g', b'p', b't', b'.', b'c',
                b'o', b'm', 0x01, 0xbb
            ]
        );
    }

    #[test]
    fn proxy_basic_auth_header_encodes_credentials() {
        let proxy = url::Url::parse("http://user:pass@127.0.0.1:7890").expect("parse proxy");

        assert_eq!(
            proxy_basic_auth_header(&proxy).expect("build proxy auth"),
            Some("Basic dXNlcjpwYXNz".to_string())
        );
    }

    #[test]
    fn inspect_ws_terminal_event_infers_usage_limit_status_without_explicit_status() {
        let event = inspect_ws_terminal_event(
            r#"{"type":"error","error":{"message":"You've hit your usage limit."}}"#,
        )
        .expect("terminal event");

        assert_eq!(event.status_code, 429);
    }

    #[test]
    fn inspect_ws_terminal_event_marks_connection_limit_terminal() {
        let payload = json!({
            "type": "error",
            "status": 400,
            "error": {
                "code": "websocket_connection_limit_reached",
                "message": "Responses websocket connection limit reached (60 minutes). Create a new websocket connection to continue."
            }
        })
        .to_string();
        let event = inspect_ws_terminal_event(payload.as_str()).expect("terminal event");

        assert_eq!(event.status_code, 400);
        assert!(is_websocket_connection_limit_terminal(&event));
    }

    #[test]
    fn infer_ws_terminal_status_maps_deactivation_message_to_403() {
        let payload = json!({
            "type": "response.failed",
            "error": {
                "message": "workspace_deactivated"
            }
        });

        assert_eq!(
            infer_ws_terminal_status(&payload, payload["error"]["message"].as_str()),
            403
        );
    }

    #[test]
    fn websocket_frame_preserves_prompt_cache_key_when_native_conversation_anchor_exists() {
        let _guard = crate::test_env_guard();
        let context = WsRequestContext {
            api_key: sample_api_key(),
            incoming_headers: sample_incoming_headers(Some("conversation-1"), None),
            prompt_cache_key: Some("sticky-thread".to_string()),
            effective_upstream_base: "https://chatgpt.com/backend-api/codex".to_string(),
            prefer_raw_errors: false,
            transparent_mode: false,
        };
        let prepared = rewrite_client_frame(
            r#"{"type":"response.create","model":"gpt-5.4","input":"hello","prompt_cache_key":"client-thread"}"#,
            &context,
        )
        .unwrap_or_else(|_| panic!("rewrite websocket frame failed"));
        let value: serde_json::Value =
            serde_json::from_str(&prepared.text).expect("parse prepared websocket frame");

        assert_eq!(
            value
                .get("prompt_cache_key")
                .and_then(serde_json::Value::as_str),
            Some("client-thread")
        );
    }

    #[test]
    fn websocket_client_metadata_preserves_rewritten_codex_metadata() {
        let incoming_headers = sample_incoming_headers_with_metadata();
        let metadata = merge_client_metadata(
            Some(json!({
                "x-codex-installation-id": "install-from-rewrite",
                "source": "rewrite"
            })),
            Some(json!({
                "x-codex-installation-id": "install-from-client",
                "source": "client",
                "count": 7,
                "enabled": true
            })),
            &incoming_headers,
        )
        .expect("merged metadata");

        assert_eq!(
            metadata,
            json!({
                "x-codex-installation-id": "install-from-rewrite",
                "source": "rewrite",
                "count": "7",
                "enabled": "true",
                "x-codex-turn-metadata": "turn-meta-1",
                "x-codex-window-id": "window-1:0",
                "x-openai-subagent": "review",
                "x-codex-parent-thread-id": "parent-thread-1"
            })
        );
    }

    #[test]
    fn websocket_frame_merges_header_metadata_into_client_metadata() {
        let _guard = crate::test_env_guard();
        let context = WsRequestContext {
            api_key: sample_api_key(),
            incoming_headers: sample_incoming_headers_with_metadata(),
            prompt_cache_key: None,
            effective_upstream_base: "https://chatgpt.com/backend-api/codex".to_string(),
            prefer_raw_errors: false,
            transparent_mode: false,
        };
        let prepared = rewrite_client_frame(
            r#"{"type":"response.create","model":"gpt-5.4","input":"hello","client_metadata":{"source":"client"}}"#,
            &context,
        )
        .unwrap_or_else(|_| panic!("rewrite websocket frame failed"));
        let value: serde_json::Value =
            serde_json::from_str(&prepared.text).expect("parse prepared websocket frame");

        assert_eq!(
            value["client_metadata"]["x-codex-turn-metadata"],
            "turn-meta-1"
        );
        assert_eq!(value["client_metadata"]["x-codex-window-id"], "window-1:0");
        assert_eq!(value["client_metadata"]["x-openai-subagent"], "review");
        assert_eq!(
            value["client_metadata"]["x-codex-parent-thread-id"],
            "parent-thread-1"
        );
        assert!(value["client_metadata"]["x-codex-installation-id"].is_string());
    }

    #[test]
    fn websocket_transparent_frame_keeps_client_text_unchanged() {
        let context = WsRequestContext {
            api_key: sample_api_key(),
            incoming_headers: sample_incoming_headers_with_metadata(),
            prompt_cache_key: Some("sticky-thread".to_string()),
            effective_upstream_base: "https://chatgpt.com/backend-api/codex".to_string(),
            prefer_raw_errors: false,
            transparent_mode: true,
        };
        let text = r#"{"type":"response.create","model":"gpt-5.4","input":"hello","reasoning":{"effort":"medium"},"service_tier":"priority","client_metadata":{"source":"client"},"unknown_field":true}"#;
        let prepared = rewrite_client_frame(text, &context)
            .unwrap_or_else(|_| panic!("rewrite websocket frame failed"));
        let value: serde_json::Value =
            serde_json::from_str(&prepared.text).expect("parse transparent frame");

        assert_eq!(prepared.text, text);
        assert_eq!(prepared.model.as_deref(), Some("gpt-5.4"));
        assert_eq!(prepared.reasoning_effort.as_deref(), Some("medium"));
        assert_eq!(prepared.service_tier.as_deref(), Some("fast"));
        assert_eq!(value["unknown_field"], true);
        assert!(value["client_metadata"]
            .get("x-codex-turn-metadata")
            .is_none());
        assert!(value.get("prompt_cache_key").is_none());
    }

    #[test]
    fn websocket_transparent_frame_allows_non_response_create_text() {
        let context = WsRequestContext {
            api_key: sample_api_key(),
            incoming_headers: sample_incoming_headers_with_metadata(),
            prompt_cache_key: Some("sticky-thread".to_string()),
            effective_upstream_base: "https://chatgpt.com/backend-api/codex".to_string(),
            prefer_raw_errors: false,
            transparent_mode: true,
        };
        let text = r#"{"type":"session.update","session":{"trace":"client-controlled"}}"#;
        let prepared = rewrite_client_frame(text, &context)
            .unwrap_or_else(|_| panic!("rewrite websocket frame failed"));

        assert_eq!(prepared.text, text);
        assert!(prepared.model.is_none());
        assert!(prepared.reasoning_effort.is_none());
        assert!(prepared.service_tier.is_none());
    }

    #[test]
    fn websocket_transparent_frame_allows_non_json_text() {
        let context = WsRequestContext {
            api_key: sample_api_key(),
            incoming_headers: sample_incoming_headers_with_metadata(),
            prompt_cache_key: Some("sticky-thread".to_string()),
            effective_upstream_base: "https://chatgpt.com/backend-api/codex".to_string(),
            prefer_raw_errors: false,
            transparent_mode: true,
        };
        let text = "client-controlled-websocket-text";
        let prepared = rewrite_client_frame(text, &context)
            .unwrap_or_else(|_| panic!("rewrite websocket frame failed"));

        assert_eq!(prepared.text, text);
        assert!(prepared.model.is_none());
        assert!(prepared.reasoning_effort.is_none());
        assert!(prepared.service_tier.is_none());
    }

    #[test]
    fn websocket_transparent_initial_binary_frame_is_forwarded() {
        let context = WsRequestContext {
            api_key: sample_api_key(),
            incoming_headers: sample_incoming_headers_with_metadata(),
            prompt_cache_key: Some("sticky-thread".to_string()),
            effective_upstream_base: "https://chatgpt.com/backend-api/codex".to_string(),
            prefer_raw_errors: false,
            transparent_mode: true,
        };
        let prepared = prepare_initial_client_frame(
            Message::Binary(b"opaque-ws-frame".to_vec().into()),
            &context,
        )
        .unwrap_or_else(|_| panic!("prepare initial websocket frame failed"));

        match prepared.upstream_message {
            UpstreamMessage::Binary(bytes) => assert_eq!(bytes.as_ref(), b"opaque-ws-frame"),
            other => panic!("unexpected upstream message: {other:?}"),
        }
        assert!(prepared.text.is_empty());
        assert!(prepared.model.is_none());
    }

    #[test]
    fn websocket_response_create_keeps_codex_field_snapshot() {
        let _guard = crate::test_env_guard();
        let context = WsRequestContext {
            api_key: sample_api_key(),
            incoming_headers: sample_incoming_headers_with_metadata(),
            prompt_cache_key: None,
            effective_upstream_base: "https://chatgpt.com/backend-api/codex".to_string(),
            prefer_raw_errors: false,
            transparent_mode: false,
        };
        let prepared = rewrite_client_frame(
            json!({
                "type": "response.create",
                "model": "gpt-5.4",
                "instructions": "stay",
                "previous_response_id": "resp_previous",
                "input": "hello",
                "tools": [{ "type": "function", "name": "ping", "parameters": { "type": "object", "properties": {} } }],
                "tool_choice": "auto",
                "parallel_tool_calls": true,
                "reasoning": { "effort": "medium" },
                "store": false,
                "stream": true,
                "include": ["reasoning.encrypted_content"],
                "service_tier": "priority",
                "prompt_cache_key": "pc_ws_snapshot",
                "text": { "format": { "type": "text" } },
                "generate": false,
                "client_metadata": {
                    "source": "ws-snapshot",
                    "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
                    "tracestate": "rojo=00f067aa0ba902b7"
                },
                "max_output_tokens": 1024,
                "metadata": { "client": "third-party" },
                "temperature": 0.2,
                "top_p": 0.9,
                "truncation": "auto",
                "user": "third-party-user",
                "unknown_field": true
            })
            .to_string()
            .as_str(),
            &context,
        )
        .unwrap_or_else(|_| panic!("rewrite websocket frame failed"));
        let value: serde_json::Value =
            serde_json::from_str(&prepared.text).expect("parse prepared websocket frame");
        let object = value.as_object().expect("prepared frame object");
        let keys = object
            .keys()
            .map(String::as_str)
            .collect::<std::collections::BTreeSet<_>>();
        let expected = [
            "client_metadata",
            "generate",
            "include",
            "input",
            "instructions",
            "max_output_tokens",
            "metadata",
            "model",
            "parallel_tool_calls",
            "previous_response_id",
            "prompt_cache_key",
            "reasoning",
            "service_tier",
            "store",
            "stream",
            "temperature",
            "text",
            "tool_choice",
            "tools",
            "top_p",
            "truncation",
            "type",
            "unknown_field",
            "user",
        ]
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();

        assert_eq!(keys, expected);
        assert_eq!(value["type"], "response.create");
        assert_eq!(value["previous_response_id"], "resp_previous");
        assert_eq!(value["generate"], false);
        assert_eq!(value["client_metadata"]["source"], "ws-snapshot");
        assert_eq!(
            value["client_metadata"]["traceparent"],
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00"
        );
        assert_eq!(
            value["client_metadata"]["tracestate"],
            "rojo=00f067aa0ba902b7"
        );
        assert_eq!(
            value["client_metadata"]["x-codex-turn-metadata"],
            "turn-meta-1"
        );
        assert_eq!(value["max_output_tokens"], 1024);
        assert_eq!(value["metadata"]["client"], "third-party");
        assert_eq!(value["temperature"], 0.2);
        assert_eq!(value["top_p"], 0.9);
        assert_eq!(value["truncation"], "auto");
        assert_eq!(value["user"], "third-party-user");
        assert_eq!(value["unknown_field"], true);
    }

    #[test]
    fn websocket_retry_can_strip_previous_response_id() {
        let text = json!({
            "type": "response.create",
            "model": "gpt-5.4",
            "previous_response_id": "resp_previous",
            "input": "follow up"
        })
        .to_string();

        let stripped = strip_previous_response_id_from_ws_text(text.as_str())
            .expect("previous_response_id should be stripped");
        let value: serde_json::Value =
            serde_json::from_str(stripped.as_str()).expect("parse stripped frame");

        assert_eq!(value["type"], "response.create");
        assert!(value.get("previous_response_id").is_none());
        assert_eq!(value["input"], "follow up");
    }

    #[test]
    fn websocket_detects_previous_response_not_found_terminal() {
        let terminal = inspect_ws_terminal_event(
            r#"{"type":"response.failed","status":400,"error":{"message":"Previous response with id 'resp_123' not found."}}"#,
        )
        .expect("terminal event");

        assert!(is_previous_response_not_found_terminal(&terminal));
    }
}
