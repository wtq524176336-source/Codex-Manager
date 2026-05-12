use super::{normalize_models_path, validate_text_input_limit_for_path, MAX_TEXT_INPUT_CHARS};

#[test]
fn normalize_models_path_maps_codex_responses_paths_without_v1() {
    assert_eq!(normalize_models_path("/responses"), "/v1/responses");
    assert_eq!(
        normalize_models_path("/responses/compact"),
        "/v1/responses/compact"
    );
    assert_eq!(
        normalize_models_path("/responses/compact?foo=bar"),
        "/v1/responses/compact?foo=bar"
    );
}

#[test]
fn normalize_models_path_maps_codex_backend_responses_paths() {
    assert_eq!(
        normalize_models_path("/backend-api/codex/responses/compact"),
        "/v1/responses/compact"
    );
    assert_eq!(
        normalize_models_path("https://chatgpt.com/backend-api/codex/responses/compact?foo=bar"),
        "/v1/responses/compact?foo=bar"
    );
    assert_eq!(
        normalize_models_path("/chatgpt.com/backend-api/codex/responses"),
        "/v1/responses"
    );
}

#[test]
fn responses_text_limit_allows_small_payloads() {
    let body = serde_json::json!({
        "instructions": "system",
        "input": [
            {
                "role": "user",
                "content": [
                    { "type": "input_text", "text": "hello" },
                    { "type": "input_text", "text": "world" }
                ]
            }
        ]
    });
    let body = serde_json::to_vec(&body).expect("serialize body");

    let result = validate_text_input_limit_for_path("/v1/responses", &body);

    assert!(result.is_ok());
}

#[test]
fn responses_text_limit_rejects_oversized_payloads() {
    let body = serde_json::json!({
        "input": "x".repeat(MAX_TEXT_INPUT_CHARS + 1),
    });
    let body = serde_json::to_vec(&body).expect("serialize body");

    let err = validate_text_input_limit_for_path("/v1/responses", &body)
        .expect_err("oversized body should be rejected");

    assert_eq!(err.max_chars, MAX_TEXT_INPUT_CHARS);
    assert_eq!(err.actual_chars, MAX_TEXT_INPUT_CHARS + 1);
    assert!(err
        .message()
        .contains("Input exceeds the maximum length of 1048576 characters."));
}

#[test]
fn chat_completions_text_limit_counts_message_content_and_instructions() {
    let first = "x".repeat(MAX_TEXT_INPUT_CHARS / 2);
    let second = "y".repeat(MAX_TEXT_INPUT_CHARS / 2 + 1);
    let body = serde_json::json!({
        "instructions": first,
        "messages": [
            {
                "role": "user",
                "content": [
                    { "type": "text", "text": second }
                ]
            }
        ]
    });
    let body = serde_json::to_vec(&body).expect("serialize body");

    let err = validate_text_input_limit_for_path("/v1/chat/completions", &body)
        .expect_err("combined text length should be rejected");

    assert_eq!(err.actual_chars, MAX_TEXT_INPUT_CHARS + 1);
}

#[test]
fn non_inference_path_skips_text_limit_validation() {
    let body = serde_json::json!({
        "input": "x".repeat(MAX_TEXT_INPUT_CHARS + 100),
    });
    let body = serde_json::to_vec(&body).expect("serialize body");

    let result = validate_text_input_limit_for_path("/v1/models", &body);

    assert!(result.is_ok());
}

#[test]
fn legacy_completions_path_no_longer_participates_in_text_limit_validation() {
    let body = serde_json::json!({
        "prompt": "x".repeat(MAX_TEXT_INPUT_CHARS + 100),
    });
    let body = serde_json::to_vec(&body).expect("serialize body");

    let result = validate_text_input_limit_for_path("/v1/completions", &body);

    assert!(result.is_ok());
}
