pub(crate) const CLIENT_CODEX: &str = "codex";
pub(crate) const PROTOCOL_OPENAI_COMPAT: &str = "openai_compat";
pub(crate) const AUTH_BEARER: &str = "authorization_bearer";
pub(crate) const ROTATION_ACCOUNT: &str = "account_rotation";
pub(crate) const ROTATION_AGGREGATE_API: &str = "aggregate_api_rotation";

/// 函数 `normalize_key`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - value: 参数 value
///
/// # 返回
/// 返回函数执行结果
fn normalize_key(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace('-', "_")
}

/// 函数 `normalize_protocol_type`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 返回函数执行结果
pub(crate) fn normalize_protocol_type(value: Option<String>) -> Result<String, String> {
    match value {
        Some(raw) => match normalize_key(&raw).as_str() {
            "codex" | "openai" | "openai_compat" => Ok(PROTOCOL_OPENAI_COMPAT.to_string()),
            other => Err(format!("unsupported protocol type: {other}")),
        },
        None => Ok(PROTOCOL_OPENAI_COMPAT.to_string()),
    }
}

/// 函数 `profile_from_protocol`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 返回函数执行结果
pub(crate) fn profile_from_protocol(
    protocol_type: &str,
) -> Result<(String, String, String), String> {
    let protocol = normalize_protocol_type(Some(protocol_type.to_string()))?;
    Ok((CLIENT_CODEX.to_string(), protocol, AUTH_BEARER.to_string()))
}

/// 函数 `normalize_rotation_strategy`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 返回函数执行结果
pub(crate) fn normalize_rotation_strategy(value: Option<String>) -> Result<String, String> {
    match value {
        Some(raw) => match normalize_key(&raw).as_str() {
            "account" | "account_rotation" | "account_rotate" | "账号轮转" => {
                Ok(ROTATION_ACCOUNT.to_string())
            }
            "aggregateapi"
            | "aggregate_api"
            | "aggregate_api_rotation"
            | "aggregateapirotation"
            | "聚合api"
            | "聚合api轮转" => Ok(ROTATION_AGGREGATE_API.to_string()),
            other => Err(format!("unsupported rotation strategy: {other}")),
        },
        None => Ok(ROTATION_ACCOUNT.to_string()),
    }
}

/// 函数 `normalize_upstream_base_url`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 返回函数执行结果
pub(crate) fn normalize_upstream_base_url(value: Option<String>) -> Result<Option<String>, String> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim().trim_end_matches('/').to_string();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let parsed =
        reqwest::Url::parse(trimmed.as_str()).map_err(|_| "invalid upstreamBaseUrl".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("invalid upstreamBaseUrl scheme".to_string());
    }
    Ok(Some(trimmed))
}

/// 函数 `normalize_static_headers_json`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 返回函数执行结果
pub(crate) fn normalize_static_headers_json(
    value: Option<String>,
) -> Result<Option<String>, String> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let parsed: serde_json::Value = serde_json::from_str(trimmed)
        .map_err(|_| "invalid staticHeadersJson: must be a JSON object".to_string())?;
    let obj = parsed
        .as_object()
        .ok_or_else(|| "invalid staticHeadersJson: must be a JSON object".to_string())?;
    for (name, value) in obj {
        if name.trim().is_empty() {
            return Err("invalid staticHeadersJson: header name is empty".to_string());
        }
        if !value.is_string() {
            return Err(format!(
                "invalid staticHeadersJson: header {name} value must be string"
            ));
        }
    }
    Ok(Some(trimmed.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_protocol_type, normalize_rotation_strategy, PROTOCOL_OPENAI_COMPAT,
        ROTATION_ACCOUNT, ROTATION_AGGREGATE_API,
    };

    #[test]
    fn normalize_rotation_strategy_keeps_existing_values() {
        assert_eq!(
            normalize_rotation_strategy(None).as_deref(),
            Ok(ROTATION_ACCOUNT)
        );
        assert_eq!(
            normalize_rotation_strategy(Some("aggregate_api_rotation".to_string())).as_deref(),
            Ok(ROTATION_AGGREGATE_API)
        );
    }

    #[test]
    fn removed_azure_protocol_is_rejected_for_profile_configuration() {
        let err = normalize_protocol_type(Some("azure_openai".to_string()))
            .expect_err("azure profile protocol should be rejected");
        assert!(err.contains("unsupported protocol type: azure_openai"));
    }

    #[test]
    fn removed_legacy_protocols_are_rejected_for_profile_configuration() {
        for value in ["legacy_native", "third_party_native"] {
            let err = normalize_protocol_type(Some(value.to_string()))
                .expect_err("legacy protocol should be rejected");
            assert!(err.contains("unsupported protocol type"));
        }
    }
}
