use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, SyncSender, TrySendError};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;

const DEFAULT_TRACE_QUEUE_CAPACITY: usize = 0;
const TRACE_FLUSH_WAIT_TIMEOUT_MS: u64 = 200;
const ENV_TRACE_QUEUE_CAPACITY: &str = "CODEXMANAGER_TRACE_QUEUE_CAPACITY";
const TRACE_PENDING_LINE_LIMIT: usize = 32;
const TRACE_RETENTION_SECS: i64 = 24 * 60 * 60;
const TRACE_RETENTION_CLEANUP_INTERVAL_SECS: i64 = 60;

static TRACE_WRITER: OnceLock<TraceAsyncWriter> = OnceLock::new();
static TRACE_SEQ: AtomicU64 = AtomicU64::new(1);
static TRACE_ERROR_TRACES: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static TRACE_PENDING_LINES: OnceLock<Mutex<HashMap<String, Vec<String>>>> = OnceLock::new();

enum TraceCommand {
    Append {
        line: String,
        flush: bool,
        ack: Option<SyncSender<()>>,
    },
    ResetPath(PathBuf),
}

enum TraceCommandSender {
    Bounded(SyncSender<TraceCommand>),
    Unbounded(Sender<TraceCommand>),
}

enum TraceSendError {
    Full,
    Disconnected,
}

impl TraceCommandSender {
    fn send(&self, command: TraceCommand) -> Result<(), TraceSendError> {
        match self {
            Self::Bounded(tx) => tx.send(command).map_err(|_| TraceSendError::Disconnected),
            Self::Unbounded(tx) => tx.send(command).map_err(|_| TraceSendError::Disconnected),
        }
    }

    fn try_send(&self, command: TraceCommand) -> Result<(), TraceSendError> {
        match self {
            Self::Bounded(tx) => match tx.try_send(command) {
                Ok(()) => Ok(()),
                Err(TrySendError::Full(_)) => Err(TraceSendError::Full),
                Err(TrySendError::Disconnected(_)) => Err(TraceSendError::Disconnected),
            },
            Self::Unbounded(tx) => tx.send(command).map_err(|_| TraceSendError::Disconnected),
        }
    }
}

struct TraceAsyncWriter {
    tx: TraceCommandSender,
    dropped: AtomicU64,
    queue_capacity: usize,
}

impl TraceAsyncWriter {
    /// 函数 `new`
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
    fn new(path: PathBuf) -> Self {
        let queue_capacity = trace_queue_capacity();
        let (tx, rx) = if queue_capacity == 0 {
            let (tx, rx) = mpsc::channel::<TraceCommand>();
            (TraceCommandSender::Unbounded(tx), rx)
        } else {
            let (tx, rx) = mpsc::sync_channel::<TraceCommand>(queue_capacity);
            (TraceCommandSender::Bounded(tx), rx)
        };
        let _ = thread::Builder::new()
            .name("gateway-trace-writer".to_string())
            .spawn(move || trace_writer_loop(rx, TraceFileWriter::new(path)));
        Self {
            tx,
            dropped: AtomicU64::new(0),
            queue_capacity,
        }
    }

    /// 函数 `append_line`
    ///
    /// 作者: gaohongshun
    ///
    /// 时间: 2026-04-02
    ///
    /// # 参数
    /// - self: 参数 self
    /// - line: 参数 line
    /// - flush: 参数 flush
    ///
    /// # 返回
    /// 无
    fn append_line(&self, line: String, flush: bool) {
        if flush {
            let (ack_tx, ack_rx) = mpsc::sync_channel(0);
            if self
                .tx
                .send(TraceCommand::Append {
                    line,
                    flush: true,
                    ack: Some(ack_tx),
                })
                .is_err()
            {
                log::warn!("gateway trace enqueue failed: writer channel closed");
                return;
            }
            let _ = ack_rx.recv_timeout(Duration::from_millis(TRACE_FLUSH_WAIT_TIMEOUT_MS));
            return;
        }

        match self.tx.try_send(TraceCommand::Append {
            line,
            flush: false,
            ack: None,
        }) {
            Ok(()) => {}
            Err(TraceSendError::Full) => {
                let dropped = self.dropped.fetch_add(1, Ordering::Relaxed) + 1;
                if dropped == 1 || dropped % 1024 == 0 {
                    log::warn!(
                        "gateway trace queue full; dropped_lines={}, capacity={}",
                        dropped,
                        self.queue_capacity
                    );
                }
            }
            Err(TraceSendError::Disconnected) => {
                log::warn!("gateway trace enqueue failed: writer channel closed");
            }
        }
    }

    /// 函数 `reset_path`
    ///
    /// 作者: gaohongshun
    ///
    /// 时间: 2026-04-02
    ///
    /// # 参数
    /// - self: 参数 self
    /// - path: 参数 path
    ///
    /// # 返回
    /// 无
    fn reset_path(&self, path: PathBuf) {
        if self.tx.send(TraceCommand::ResetPath(path)).is_err() {
            log::warn!("gateway trace reset-path failed: writer channel closed");
        }
    }
}

struct TraceFileWriter {
    path: PathBuf,
    writer: Option<BufWriter<File>>,
    last_retention_cleanup_at: i64,
}

impl TraceFileWriter {
    /// 函数 `new`
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
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            writer: None,
            last_retention_cleanup_at: 0,
        }
    }

    /// 函数 `reset_path`
    ///
    /// 作者: gaohongshun
    ///
    /// 时间: 2026-04-02
    ///
    /// # 参数
    /// - self: 参数 self
    /// - next_path: 参数 next_path
    ///
    /// # 返回
    /// 无
    fn reset_path(&mut self, next_path: PathBuf) {
        if self.path == next_path {
            return;
        }
        self.path = next_path;
        self.writer = None;
        self.last_retention_cleanup_at = 0;
    }

    /// 函数 `append_line`
    ///
    /// 作者: gaohongshun
    ///
    /// 时间: 2026-04-02
    ///
    /// # 参数
    /// - self: 参数 self
    /// - line: 参数 line
    /// - flush: 参数 flush
    ///
    /// # 返回
    /// 返回函数执行结果
    fn append_line(&mut self, line: &str, flush: bool) -> std::io::Result<()> {
        if let Err(err) = self.prune_expired_lines(current_trace_ts()) {
            log::warn!(
                "gateway trace retention cleanup failed: path={}, err={}",
                self.path.display(),
                err
            );
            self.writer = None;
        }
        let writer = self.ensure_open_writer()?;
        writeln!(writer, "{line}")?;
        if flush {
            writer.flush()?;
        }
        Ok(())
    }

    fn prune_expired_lines(&mut self, now: i64) -> std::io::Result<()> {
        if self.last_retention_cleanup_at != 0
            && now.saturating_sub(self.last_retention_cleanup_at)
                < TRACE_RETENTION_CLEANUP_INTERVAL_SECS
        {
            return Ok(());
        }
        self.last_retention_cleanup_at = now;
        let cutoff = now.saturating_sub(TRACE_RETENTION_SECS);
        if let Some(writer) = self.writer.as_mut() {
            writer.flush()?;
        }
        self.writer = None;
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(err) => return Err(err),
        };
        if bytes.is_empty() {
            return Ok(());
        }
        let content = String::from_utf8_lossy(&bytes);
        let mut retained = String::with_capacity(content.len());
        let mut dropped = 0usize;
        for line in content.lines() {
            if trace_line_ts(line).is_some_and(|ts| ts >= cutoff) {
                retained.push_str(line);
                retained.push('\n');
            } else {
                dropped += 1;
            }
        }
        if dropped > 0 {
            fs::write(&self.path, retained.as_bytes())?;
            log::debug!(
                "event=gateway_trace_retention_pruned path={} dropped_lines={} retention_secs={}",
                self.path.display(),
                dropped,
                TRACE_RETENTION_SECS
            );
        }
        Ok(())
    }

    /// 函数 `ensure_open_writer`
    ///
    /// 作者: gaohongshun
    ///
    /// 时间: 2026-04-02
    ///
    /// # 参数
    /// - self: 参数 self
    ///
    /// # 返回
    /// 返回函数执行结果
    fn ensure_open_writer(&mut self) -> std::io::Result<&mut BufWriter<File>> {
        if self.writer.is_none() {
            let file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)?;
            self.writer = Some(BufWriter::new(file));
        }
        Ok(self.writer.as_mut().expect("writer should be initialized"))
    }
}

/// 函数 `trace_file_path_from_env`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// 无
///
/// # 返回
/// 返回函数执行结果
fn trace_file_path_from_env() -> PathBuf {
    if let Ok(db_path) = std::env::var("CODEXMANAGER_DB_PATH") {
        let path = PathBuf::from(db_path);
        if let Some(parent) = path.parent() {
            return parent.join("gateway-trace.log");
        }
    }
    PathBuf::from("gateway-trace.log")
}

/// 函数 `sanitize_text`
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
fn sanitize_text(value: &str) -> String {
    let redacted = redact_base64_images_for_log(value);
    let redacted = redact_image_generation_payloads_for_log(redacted.as_str());
    redacted.replace(['\r', '\n'], " ")
}

fn sanitize_raw_diagnostic_text(value: &str) -> String {
    value.replace(['\r', '\n'], " ")
}

fn redact_base64_images_for_log(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut rest = value;
    loop {
        let lower = rest.to_ascii_lowercase();
        let Some(image_start) = lower.find("data:image/") else {
            output.push_str(rest);
            break;
        };
        output.push_str(&rest[..image_start]);
        let image_rest = &rest[image_start..];
        let image_lower = &lower[image_start..];
        let Some(base64_marker) = image_lower.find(";base64,") else {
            output.push_str(image_rest);
            break;
        };
        let data_start = image_start + base64_marker + ";base64,".len();
        output.push_str(&rest[image_start..data_start]);
        output.push_str("<base64 image omitted>");
        let data = &rest[data_start..];
        let data_end = data
            .find(|ch: char| !(ch.is_ascii_alphanumeric() || matches!(ch, '+' | '/' | '=')))
            .unwrap_or(data.len());
        rest = &data[data_end..];
    }
    output
}

fn redact_image_generation_payloads_for_log(value: &str) -> String {
    if !value.contains("image_generation_call") {
        return value.to_string();
    }

    if let Ok(mut parsed) = serde_json::from_str::<Value>(value) {
        redact_image_generation_value(&mut parsed);
        return serde_json::to_string(&parsed).unwrap_or_else(|_| value.to_string());
    }

    let redacted = redact_json_string_field_for_log(value, "result");
    redact_json_string_field_for_log(redacted.as_str(), "partial_image_b64")
}

fn redact_image_generation_value(value: &mut Value) {
    match value {
        Value::Array(items) => {
            for item in items {
                redact_image_generation_value(item);
            }
        }
        Value::Object(obj) => {
            let event_type = obj.get("type").and_then(Value::as_str);
            let is_image_call = event_type == Some("image_generation_call");
            let is_partial_image =
                event_type == Some("response.image_generation_call.partial_image");

            if is_image_call {
                redact_json_object_string_field(obj, "result");
            }
            if is_partial_image {
                redact_json_object_string_field(obj, "partial_image_b64");
            }
            for child in obj.values_mut() {
                redact_image_generation_value(child);
            }
        }
        _ => {}
    }
}

fn redact_json_object_string_field(obj: &mut serde_json::Map<String, Value>, field: &str) {
    if obj.get(field).and_then(Value::as_str).is_some() {
        obj.insert(
            field.to_string(),
            Value::String("<base64 image omitted>".to_string()),
        );
    }
}

fn redact_json_string_field_for_log(value: &str, field: &str) -> String {
    let key = format!("\"{field}\"");
    let bytes = value.as_bytes();
    let mut output = String::with_capacity(value.len());
    let mut copy_start = 0usize;
    let mut search_start = 0usize;

    while let Some(relative_key_start) = value[search_start..].find(key.as_str()) {
        let key_start = search_start + relative_key_start;
        let mut cursor = key_start + key.len();
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || bytes[cursor] != b':' {
            search_start = key_start + key.len();
            continue;
        }
        cursor += 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || bytes[cursor] != b'"' {
            search_start = cursor;
            continue;
        }

        let value_quote = cursor;
        let mut value_end = value_quote + 1;
        let mut escaped = false;
        while value_end < bytes.len() {
            let byte = bytes[value_end];
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                break;
            }
            value_end += 1;
        }
        if value_end >= bytes.len() {
            break;
        }

        output.push_str(&value[copy_start..=value_quote]);
        output.push_str("<base64 image omitted>");
        output.push('"');
        copy_start = value_end + 1;
        search_start = value_end + 1;
    }

    output.push_str(&value[copy_start..]);
    output
}

/// 函数 `short_fingerprint`
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
fn short_fingerprint(value: &str) -> String {
    let mut hash: u64 = 14695981039346656037;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1099511628211);
    }
    format!("{hash:016x}")
}

/// 函数 `append_trace_line`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - line: 参数 line
/// - flush: 参数 flush
///
/// # 返回
/// 无
fn append_trace_line(line: String, flush: bool) {
    trace_writer().append_line(line, flush);
}

/// 函数 `trace_error_traces`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// 无
///
/// # 返回
/// 返回函数执行结果
fn trace_error_traces() -> &'static Mutex<HashSet<String>> {
    TRACE_ERROR_TRACES.get_or_init(|| Mutex::new(HashSet::new()))
}

/// 函数 `trace_pending_lines`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// 无
///
/// # 返回
/// 返回函数执行结果
fn trace_pending_lines() -> &'static Mutex<HashMap<String, Vec<String>>> {
    TRACE_PENDING_LINES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 函数 `mark_trace_has_error`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - trace_id: 参数 trace_id
///
/// # 返回
/// 无
fn mark_trace_has_error(trace_id: &str) {
    if let Ok(mut traces) = trace_error_traces().lock() {
        traces.insert(trace_id.to_string());
    }
}

/// 函数 `clear_trace_error`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - trace_id: 参数 trace_id
///
/// # 返回
/// 无
fn clear_trace_error(trace_id: &str) {
    if let Ok(mut traces) = trace_error_traces().lock() {
        traces.remove(trace_id);
    }
}

/// 函数 `current_trace_ts`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// 无
///
/// # 返回
/// 返回函数执行结果
fn current_trace_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0)
}

fn trace_line_ts(line: &str) -> Option<i64> {
    let rest = line.strip_prefix("ts=")?;
    let value = rest.split_whitespace().next()?;
    value.parse::<i64>().ok()
}

/// 函数 `buffer_trace_line`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - trace_id: 参数 trace_id
/// - line: 参数 line
///
/// # 返回
/// 无
fn buffer_trace_line(trace_id: &str, line: String) {
    if trace_id.trim().is_empty() {
        return;
    }
    let Ok(mut pending) = trace_pending_lines().lock() else {
        return;
    };
    let entry = pending.entry(trace_id.to_string()).or_default();
    if entry.len() < TRACE_PENDING_LINE_LIMIT {
        entry.push(line);
        return;
    }
    if entry
        .last()
        .is_some_and(|value| value.contains("event=TRACE_BUFFER_TRUNCATED"))
    {
        return;
    }
    let truncated_marker = format!(
        "ts={} event=TRACE_BUFFER_TRUNCATED trace_id={} dropped_after={}",
        current_trace_ts(),
        sanitize_text(trace_id),
        TRACE_PENDING_LINE_LIMIT,
    );
    if let Some(last) = entry.last_mut() {
        *last = truncated_marker;
    }
}

/// 函数 `flush_trace_lines`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - trace_id: 参数 trace_id
///
/// # 返回
/// 无
fn flush_trace_lines(trace_id: &str) {
    let lines = trace_pending_lines()
        .lock()
        .ok()
        .and_then(|mut pending| pending.remove(trace_id));
    if let Some(lines) = lines {
        for line in lines {
            append_trace_line(line, false);
        }
    }
}

/// 函数 `clear_trace_state`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - trace_id: 参数 trace_id
///
/// # 返回
/// 无
fn clear_trace_state(trace_id: &str) {
    if let Ok(mut pending) = trace_pending_lines().lock() {
        pending.remove(trace_id);
    }
    clear_trace_error(trace_id);
}

/// 函数 `trace_has_error`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - trace_id: 参数 trace_id
///
/// # 返回
/// 返回函数执行结果
#[cfg(test)]
fn trace_has_error(trace_id: &str) -> bool {
    trace_error_traces()
        .lock()
        .map(|traces| traces.contains(trace_id))
        .unwrap_or(false)
}

/// 函数 `has_error_text`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - error: 参数 error
///
/// # 返回
/// 返回函数执行结果
fn has_error_text(error: Option<&str>) -> bool {
    error
        .map(str::trim)
        .is_some_and(|value| !value.is_empty() && value != "-")
}

/// 函数 `trace_writer`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// 无
///
/// # 返回
/// 返回函数执行结果
fn trace_writer() -> &'static TraceAsyncWriter {
    TRACE_WRITER.get_or_init(|| TraceAsyncWriter::new(trace_file_path_from_env()))
}

/// 函数 `trace_writer_loop`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - rx: 参数 rx
/// - writer: 参数 writer
///
/// # 返回
/// 无
fn trace_writer_loop(rx: Receiver<TraceCommand>, mut writer: TraceFileWriter) {
    while let Ok(command) = rx.recv() {
        match command {
            TraceCommand::Append { line, flush, ack } => {
                if let Err(err) = writer.append_line(&line, flush) {
                    log::warn!(
                        "gateway trace write failed: path={}, err={}",
                        writer.path.display(),
                        err
                    );
                    writer.writer = None;
                }
                if let Some(ack) = ack {
                    let _ = ack.send(());
                }
            }
            TraceCommand::ResetPath(path) => writer.reset_path(path),
        }
    }
}

/// 函数 `trace_queue_capacity`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// 无
///
/// # 返回
/// 返回函数执行结果
fn trace_queue_capacity() -> usize {
    std::env::var(ENV_TRACE_QUEUE_CAPACITY)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(DEFAULT_TRACE_QUEUE_CAPACITY)
}

/// 函数 `reload_from_env`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - super: 参数 super
///
/// # 返回
/// 无
pub(super) fn reload_from_env() {
    let path = trace_file_path_from_env();
    trace_writer().reset_path(path);
}

/// 函数 `next_trace_id`
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
pub(crate) fn next_trace_id() -> String {
    trace_writer().reset_path(trace_file_path_from_env());
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|v| v.as_millis())
        .unwrap_or(0);
    let seq = TRACE_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("trc_{millis}_{seq:x}")
}

/// 函数 `log_request_start`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 无
pub(crate) fn log_request_start(
    trace_id: &str,
    key_id: &str,
    method: &str,
    path: &str,
    model: Option<&str>,
    reasoning: Option<&str>,
    service_tier: Option<&str>,
    is_stream: bool,
    request_type: &str,
    protocol_type: &str,
) {
    let line = format!(
        "ts={} event=REQUEST_START trace_id={} key_id={} method={} path={} request_type={} model={} reasoning={} service_tier={} stream={} protocol={}",
        current_trace_ts(),
        sanitize_text(trace_id),
        sanitize_text(key_id),
        sanitize_text(method),
        sanitize_text(path),
        sanitize_text(request_type),
        sanitize_text(model.unwrap_or("-")),
        sanitize_text(reasoning.unwrap_or("-")),
        sanitize_text(service_tier.unwrap_or("-")),
        if is_stream { "true" } else { "false" },
        sanitize_text(protocol_type),
    );
    append_trace_line(line, true);
}

pub(crate) fn log_local_request_ingress(
    trace_id: &str,
    method: &str,
    path: &str,
    body_len: usize,
    content_length: Option<&str>,
    transfer_encoding: Option<&str>,
    content_type: Option<&str>,
    user_agent: Option<&str>,
    originator: Option<&str>,
    is_native_codex_client: bool,
) {
    let line = format!(
        "ts={} event=LOCAL_REQUEST_INGRESS trace_id={} method={} path={} body_len={} content_length={} transfer_encoding={} content_type={} user_agent={} originator={} native_codex={}",
        current_trace_ts(),
        sanitize_text(trace_id),
        sanitize_text(method),
        sanitize_text(path),
        body_len,
        sanitize_text(content_length.unwrap_or("-")),
        sanitize_text(transfer_encoding.unwrap_or("-")),
        sanitize_text(content_type.unwrap_or("-")),
        sanitize_text(user_agent.unwrap_or("-")),
        sanitize_text(originator.unwrap_or("-")),
        if is_native_codex_client { "true" } else { "false" },
    );
    append_trace_line(line, true);
}

pub(crate) fn log_local_request_payload(trace_id: &str, headers: &str, body: &[u8]) {
    let body_text = String::from_utf8_lossy(body);
    let line = format!(
        "ts={} event=LOCAL_REQUEST_PAYLOAD trace_id={} headers={} body={}",
        current_trace_ts(),
        sanitize_text(trace_id),
        sanitize_raw_diagnostic_text(headers),
        sanitize_raw_diagnostic_text(body_text.as_ref()),
    );
    append_trace_line(line, true);
}

pub(crate) fn log_request_execution_plan(
    trace_id: &str,
    path: &str,
    protocol_type: &str,
    executor_kind: &str,
    route_kind: &str,
) {
    let line = format!(
        "ts={} event=REQUEST_EXECUTION_PLAN trace_id={} path={} protocol={} executor_kind={} route_kind={}",
        current_trace_ts(),
        sanitize_text(trace_id),
        sanitize_text(path),
        sanitize_text(protocol_type),
        sanitize_text(executor_kind),
        sanitize_text(route_kind),
    );
    append_trace_line(line, true);
}

pub(crate) fn log_aggregate_attempt(
    trace_id: &str,
    supplier_name: Option<&str>,
    base_url: &str,
    effective_path: &str,
    upstream_url: &str,
    body_len: usize,
    is_stream: bool,
    attempt_idx: usize,
) {
    let line = format!(
        "ts={} event=AGGREGATE_ATTEMPT trace_id={} supplier={} base_url={} effective_path={} upstream_url={} body_len={} stream={} attempt={}",
        current_trace_ts(),
        sanitize_text(trace_id),
        sanitize_text(supplier_name.unwrap_or("-")),
        sanitize_text(base_url),
        sanitize_text(effective_path),
        sanitize_text(upstream_url),
        body_len,
        if is_stream { "true" } else { "false" },
        attempt_idx,
    );
    append_trace_line(line, true);
}

pub(crate) fn log_aggregate_body_rewrite(
    trace_id: &str,
    stage: &str,
    content_encoding: Option<&str>,
    input_body_len: usize,
    output_body_len: usize,
    decoded_zstd: bool,
    input_json: bool,
    output_json: bool,
    skip_content_encoding: bool,
    note: &str,
) {
    let line = format!(
        "ts={} event=AGGREGATE_BODY_REWRITE trace_id={} stage={} content_encoding={} input_body_len={} output_body_len={} decoded_zstd={} input_json={} output_json={} skip_content_encoding={} note={}",
        current_trace_ts(),
        sanitize_text(trace_id),
        sanitize_text(stage),
        sanitize_text(content_encoding.unwrap_or("-")),
        input_body_len,
        output_body_len,
        if decoded_zstd { "true" } else { "false" },
        if input_json { "true" } else { "false" },
        if output_json { "true" } else { "false" },
        if skip_content_encoding { "true" } else { "false" },
        sanitize_text(note),
    );
    append_trace_line(line, true);
}

pub(crate) fn log_aggregate_prompt_cache_key_decision(
    trace_id: &str,
    path: &str,
    native_codex_client: bool,
    source: &str,
    before_has_prompt_cache_key: bool,
    after_has_prompt_cache_key: bool,
    prompt_cache_key: Option<&str>,
    local_conversation_id: Option<&str>,
) {
    let prompt_cache_key_fp = prompt_cache_key
        .map(short_fingerprint)
        .unwrap_or_else(|| "-".to_string());
    let local_conversation_fp = local_conversation_id
        .map(short_fingerprint)
        .unwrap_or_else(|| "-".to_string());
    let line = format!(
        "ts={} event=AGGREGATE_PROMPT_CACHE_KEY trace_id={} path={} native_codex={} source={} before_has_prompt_cache_key={} after_has_prompt_cache_key={} prompt_cache_key_fp={} local_conversation_fp={}",
        current_trace_ts(),
        sanitize_text(trace_id),
        sanitize_text(path),
        if native_codex_client { "true" } else { "false" },
        sanitize_text(source),
        if before_has_prompt_cache_key { "true" } else { "false" },
        if after_has_prompt_cache_key { "true" } else { "false" },
        sanitize_text(prompt_cache_key_fp.as_str()),
        sanitize_text(local_conversation_fp.as_str()),
    );
    append_trace_line(line, true);
}

pub(crate) fn log_aggregate_request_payload(
    trace_id: &str,
    upstream_url: &str,
    auth: &str,
    headers: &str,
    body: &[u8],
    attempt_idx: usize,
) {
    let body_text = String::from_utf8_lossy(body);
    let line = format!(
        "ts={} event=AGGREGATE_REQUEST_PAYLOAD trace_id={} upstream_url={} auth={} headers={} body={} attempt={}",
        current_trace_ts(),
        sanitize_text(trace_id),
        sanitize_raw_diagnostic_text(upstream_url),
        sanitize_raw_diagnostic_text(auth),
        sanitize_raw_diagnostic_text(headers),
        sanitize_raw_diagnostic_text(body_text.as_ref()),
        attempt_idx,
    );
    append_trace_line(line, true);
}

pub(crate) fn log_aggregate_upstream_result(
    trace_id: &str,
    upstream_url: &str,
    status_code: Option<u16>,
    response_body_len: Option<usize>,
    response_body: Option<&[u8]>,
    error: Option<&str>,
    attempt_idx: usize,
) {
    let response_body_text = response_body.map(String::from_utf8_lossy);
    let line = format!(
        "ts={} event=AGGREGATE_UPSTREAM_RESULT trace_id={} upstream_url={} status={} response_body_len={} response_body={} attempt={} error={}",
        current_trace_ts(),
        sanitize_text(trace_id),
        sanitize_text(upstream_url),
        status_code
            .map(|value| value.to_string())
            .unwrap_or_else(|| "-".to_string()),
        response_body_len
            .map(|value| value.to_string())
            .unwrap_or_else(|| "-".to_string()),
        sanitize_raw_diagnostic_text(
            response_body_text
                .as_ref()
                .map(|value| value.as_ref())
                .unwrap_or("-"),
        ),
        attempt_idx,
        sanitize_text(error.unwrap_or("-")),
    );
    append_trace_line(line, true);
}

pub(crate) fn log_client_service_tier(
    trace_id: &str,
    transport: &str,
    path: &str,
    has_field: bool,
    raw_value: Option<&str>,
    normalized_value: Option<&str>,
) {
    let line = format!(
        "ts={} event=CLIENT_SERVICE_TIER trace_id={} transport={} path={} has_field={} raw_service_tier={} normalized_service_tier={}",
        current_trace_ts(),
        sanitize_text(trace_id),
        sanitize_text(transport),
        sanitize_text(path),
        if has_field { "true" } else { "false" },
        sanitize_text(raw_value.unwrap_or("-")),
        sanitize_text(normalized_value.unwrap_or("-")),
    );
    buffer_trace_line(trace_id, line);
}

/// 函数 `log_request_body_preview`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 无
pub(crate) fn log_request_body_preview(trace_id: &str, body: &[u8]) {
    let _ = (trace_id, body, super::trace_body_preview_max_bytes());
}

/// 函数 `log_request_gate_wait`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 无
pub(crate) fn log_request_gate_wait(trace_id: &str, key_id: &str, path: &str, model: Option<&str>) {
    let _ = (trace_id, key_id, path, model);
}

/// 函数 `log_request_gate_acquired`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 无
pub(crate) fn log_request_gate_acquired(
    trace_id: &str,
    key_id: &str,
    path: &str,
    model: Option<&str>,
    wait_ms: u128,
) {
    let _ = (trace_id, key_id, path, model, wait_ms);
}

/// 函数 `log_request_gate_skip`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 无
pub(crate) fn log_request_gate_skip(trace_id: &str, reason: &str) {
    let _ = (trace_id, reason);
}

/// 函数 `log_candidate_start`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 无
pub(crate) fn log_candidate_start(
    trace_id: &str,
    idx: usize,
    total: usize,
    account_id: &str,
    strip_session_affinity: bool,
) {
    let line = format!(
        "ts={} event=CANDIDATE_START trace_id={} candidate={}/{} account_id={} strip_session_affinity={}",
        current_trace_ts(),
        sanitize_text(trace_id),
        idx + 1,
        total,
        sanitize_text(account_id),
        if strip_session_affinity { "true" } else { "false" },
    );
    buffer_trace_line(trace_id, line);
}

/// 函数 `log_candidate_pool`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 无
pub(crate) fn log_candidate_pool(
    trace_id: &str,
    key_id: &str,
    strategy: &str,
    rotation_source: &str,
    strategy_applied: bool,
    candidates: &[String],
) {
    let candidates = if candidates.is_empty() {
        "-".to_string()
    } else {
        candidates
            .iter()
            .map(|value| sanitize_text(value))
            .collect::<Vec<_>>()
            .join(",")
    };
    let line = format!(
        "ts={} event=CANDIDATE_POOL trace_id={} key_id={} strategy={} rotation_source={} strategy_applied={} candidates={}",
        current_trace_ts(),
        sanitize_text(trace_id),
        sanitize_text(key_id),
        sanitize_text(strategy),
        sanitize_text(rotation_source),
        if strategy_applied { "true" } else { "false" },
        candidates,
    );
    buffer_trace_line(trace_id, line);
}

/// 函数 `log_candidate_skip`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 无
pub(crate) fn log_candidate_skip(
    trace_id: &str,
    idx: usize,
    total: usize,
    account_id: &str,
    reason: &str,
) {
    let line = format!(
        "ts={} event=CANDIDATE_SKIP trace_id={} candidate={}/{} account_id={} reason={}",
        current_trace_ts(),
        sanitize_text(trace_id),
        idx + 1,
        total,
        sanitize_text(account_id),
        sanitize_text(reason),
    );
    buffer_trace_line(trace_id, line);
}

/// 函数 `log_attempt_result`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 无
pub(crate) fn log_attempt_result(
    trace_id: &str,
    account_id: &str,
    upstream_url: Option<&str>,
    status_code: u16,
    error: Option<&str>,
) {
    let should_mark_error = status_code >= 400 || has_error_text(error);
    if should_mark_error {
        mark_trace_has_error(trace_id);
    }
    let line = format!(
        "ts={} event=ATTEMPT_RESULT trace_id={} account_id={} upstream_url={} status={} code={} error={}",
        current_trace_ts(),
        sanitize_text(trace_id),
        sanitize_text(account_id),
        sanitize_text(upstream_url.unwrap_or("-")),
        status_code,
        sanitize_text(crate::error_codes::code_or_dash(error)),
        sanitize_text(error.unwrap_or("-")),
    );
    buffer_trace_line(trace_id, line);
}

/// 函数 `log_bridge_result`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 无
pub(crate) struct BridgeResultLog<'a> {
    pub trace_id: &'a str,
    pub adapter: &'a str,
    pub path: &'a str,
    pub is_stream: bool,
    pub stream_terminal_seen: bool,
    pub stream_terminal_error: Option<&'a str>,
    pub delivery_error: Option<&'a str>,
    pub output_text_len: usize,
    pub output_tokens: Option<i64>,
    pub delivered_status_code: Option<u16>,
    pub upstream_error_hint: Option<&'a str>,
    pub upstream_request_id: Option<&'a str>,
    pub upstream_cf_ray: Option<&'a str>,
    pub upstream_auth_error: Option<&'a str>,
    pub upstream_identity_error_code: Option<&'a str>,
    pub upstream_content_type: Option<&'a str>,
    pub last_sse_event_type: Option<&'a str>,
}

fn bridge_result_has_error(params: &BridgeResultLog<'_>) -> bool {
    params.delivery_error.is_some()
        || params.stream_terminal_error.is_some()
        || (params.is_stream && !params.stream_terminal_seen)
        || has_error_text(params.upstream_error_hint)
        || has_error_text(params.upstream_auth_error)
        || has_error_text(params.upstream_identity_error_code)
}

fn bridge_result_line(event: &str, params: &BridgeResultLog<'_>) -> String {
    format!(
        "ts={} event={} trace_id={} adapter={} path={} stream={} terminal_seen={} terminal_error={} delivery_error={} output_text_len={} output_tokens={} delivered_status={} upstream_hint={} upstream_request_id={} upstream_cf_ray={} upstream_auth_error={} upstream_identity_error_code={} upstream_content_type={} last_sse_event={}",
        current_trace_ts(),
        sanitize_text(event),
        sanitize_text(params.trace_id),
        sanitize_text(params.adapter),
        sanitize_text(params.path),
        if params.is_stream { "true" } else { "false" },
        if params.stream_terminal_seen { "true" } else { "false" },
        sanitize_text(params.stream_terminal_error.unwrap_or("-")),
        sanitize_text(params.delivery_error.unwrap_or("-")),
        params.output_text_len,
        params.output_tokens
            .map(|value| value.to_string())
            .unwrap_or_else(|| "-".to_string()),
        params
            .delivered_status_code
            .map(|value| value.to_string())
            .unwrap_or_else(|| "-".to_string()),
        sanitize_text(params.upstream_error_hint.unwrap_or("-")),
        sanitize_text(params.upstream_request_id.unwrap_or("-")),
        sanitize_text(params.upstream_cf_ray.unwrap_or("-")),
        sanitize_text(params.upstream_auth_error.unwrap_or("-")),
        sanitize_text(params.upstream_identity_error_code.unwrap_or("-")),
        sanitize_text(params.upstream_content_type.unwrap_or("-")),
        sanitize_text(params.last_sse_event_type.unwrap_or("-")),
    )
}

pub(crate) fn log_bridge_result(params: BridgeResultLog<'_>) {
    if bridge_result_has_error(&params) {
        mark_trace_has_error(params.trace_id);
    }
    let line = bridge_result_line("BRIDGE_RESULT", &params);
    buffer_trace_line(params.trace_id, line);
}

pub(crate) fn log_aggregate_bridge_result(params: BridgeResultLog<'_>) {
    if bridge_result_has_error(&params) {
        mark_trace_has_error(params.trace_id);
    }
    let line = bridge_result_line("AGGREGATE_BRIDGE_RESULT", &params);
    append_trace_line(line, true);
}

/// 函数 `log_attempt_profile`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 无
pub(crate) struct AttemptProfileLog<'a> {
    pub trace_id: &'a str,
    pub account_id: &'a str,
    pub candidate_index: usize,
    pub total: usize,
    pub strip_session_affinity: bool,
    pub has_incoming_session: bool,
    pub has_incoming_turn_state: bool,
    pub has_incoming_conversation: bool,
    pub prompt_cache_key: Option<&'a str>,
    pub request_shape: Option<&'a str>,
    pub body_len: usize,
    pub body_model: Option<&'a str>,
}

pub(crate) fn log_attempt_profile(params: AttemptProfileLog<'_>) {
    let AttemptProfileLog {
        trace_id,
        account_id,
        candidate_index,
        total,
        strip_session_affinity,
        has_incoming_session,
        has_incoming_turn_state,
        has_incoming_conversation,
        prompt_cache_key,
        request_shape,
        body_len,
        body_model,
    } = params;
    let prompt_cache_key_fp = prompt_cache_key
        .map(short_fingerprint)
        .unwrap_or_else(|| "-".to_string());
    let line = format!(
        "ts={} event=ATTEMPT_PROFILE trace_id={} account_id={} candidate={}/{} strip_session_affinity={} incoming_session={} incoming_turn_state={} incoming_conversation={} prompt_cache_key_fp={} request_shape={} body_len={} body_model={}",
        current_trace_ts(),
        sanitize_text(trace_id),
        sanitize_text(account_id),
        candidate_index + 1,
        total,
        if strip_session_affinity { "true" } else { "false" },
        if has_incoming_session { "true" } else { "false" },
        if has_incoming_turn_state { "true" } else { "false" },
        if has_incoming_conversation { "true" } else { "false" },
        sanitize_text(prompt_cache_key_fp.as_str()),
        sanitize_text(request_shape.unwrap_or("-")),
        body_len,
        sanitize_text(body_model.unwrap_or("-")),
    );
    buffer_trace_line(trace_id, line);
}

/// 函数 `log_request_final`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 无
pub(crate) fn log_request_final(
    trace_id: &str,
    status_code: u16,
    final_account_id: Option<&str>,
    upstream_url: Option<&str>,
    error: Option<&str>,
    elapsed_ms: u128,
) {
    let should_mark_error = status_code >= 400 || has_error_text(error);
    if should_mark_error {
        mark_trace_has_error(trace_id);
        return;
    }
    let _ = (final_account_id, upstream_url, elapsed_ms);
    clear_trace_state(trace_id);
}

/// 函数 `log_failed_request`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - crate: 参数 crate
///
/// # 返回
/// 无
pub(crate) struct FailedRequestLog<'a> {
    pub ts: i64,
    pub trace_id: Option<&'a str>,
    pub key_id: Option<&'a str>,
    pub account_id: Option<&'a str>,
    pub method: &'a str,
    pub request_path: &'a str,
    pub original_path: Option<&'a str>,
    pub adapted_path: Option<&'a str>,
    pub request_type: Option<&'a str>,
    pub model: Option<&'a str>,
    pub reasoning_effort: Option<&'a str>,
    pub service_tier: Option<&'a str>,
    pub upstream_url: Option<&'a str>,
    pub status_code: Option<u16>,
    pub error: Option<&'a str>,
    pub duration_ms: Option<i64>,
}

pub(crate) fn log_failed_request(params: FailedRequestLog<'_>) {
    let FailedRequestLog {
        ts,
        trace_id,
        key_id,
        account_id,
        method,
        request_path,
        original_path,
        adapted_path,
        request_type,
        model,
        reasoning_effort,
        service_tier,
        upstream_url,
        status_code,
        error,
        duration_ms,
    } = params;
    if !status_code.is_some_and(|status| status >= 400) && !has_error_text(error) {
        return;
    }
    if let Some(trace_id) = trace_id {
        flush_trace_lines(trace_id);
    }
    let code = crate::error_codes::code_or_dash(error);
    let line = format!(
        "ts={ts} event=FAILED_REQUEST trace_id={} key_id={} account_id={} method={} request_path={} original_path={} adapted_path={} request_type={} model={} reasoning={} service_tier={} upstream_url={} status={} elapsed_ms={} code={} error={}",
        sanitize_text(trace_id.unwrap_or("-")),
        sanitize_text(key_id.unwrap_or("-")),
        sanitize_text(account_id.unwrap_or("-")),
        sanitize_text(method),
        sanitize_text(request_path),
        sanitize_text(original_path.unwrap_or("-")),
        sanitize_text(adapted_path.unwrap_or("-")),
        sanitize_text(request_type.unwrap_or("http")),
        sanitize_text(model.unwrap_or("-")),
        sanitize_text(reasoning_effort.unwrap_or("-")),
        sanitize_text(service_tier.unwrap_or("-")),
        sanitize_text(upstream_url.unwrap_or("-")),
        status_code
            .map(|value| value.to_string())
            .unwrap_or_else(|| "-".to_string()),
        duration_ms
            .map(|value| value.to_string())
            .unwrap_or_else(|| "-".to_string()),
        sanitize_text(code),
        sanitize_text(error.unwrap_or("-")),
    );
    append_trace_line(line, true);
    if let Some(trace_id) = trace_id {
        clear_trace_state(trace_id);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        clear_trace_error, has_error_text, log_failed_request, mark_trace_has_error, sanitize_text,
        trace_has_error, trace_queue_capacity,
    };

    /// 函数 `has_error_text_ignores_empty_and_dash`
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
    fn has_error_text_ignores_empty_and_dash() {
        assert!(!has_error_text(None));
        assert!(!has_error_text(Some("")));
        assert!(!has_error_text(Some(" - ")));
        assert!(has_error_text(Some("upstream failed")));
    }

    /// 函数 `trace_error_state_can_mark_and_clear`
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
    fn trace_error_state_can_mark_and_clear() {
        let trace_id = "trc_trace_log_unit";
        clear_trace_error(trace_id);
        assert!(!trace_has_error(trace_id));
        mark_trace_has_error(trace_id);
        assert!(trace_has_error(trace_id));
        clear_trace_error(trace_id);
        assert!(!trace_has_error(trace_id));
    }

    /// 函数 `request_record_ignores_success_without_error`
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
    fn request_record_ignores_success_without_error() {
        log_failed_request(super::FailedRequestLog {
            ts: 1_772_000_000,
            trace_id: Some("trc_success"),
            key_id: Some("gk_success"),
            account_id: Some("acc_success"),
            method: "POST",
            request_path: "/v1/responses",
            original_path: Some("/v1/responses"),
            adapted_path: Some("/v1/responses"),
            request_type: Some("http"),
            model: Some("gpt-5.4"),
            reasoning_effort: Some("high"),
            service_tier: Some("fast"),
            upstream_url: Some("https://chatgpt.com/backend-api/codex/responses"),
            status_code: Some(200),
            error: None,
            duration_ms: Some(18),
        });
    }

    #[test]
    fn trace_queue_capacity_zero_means_unbounded() {
        let _guard = crate::test_env_guard();
        std::env::set_var("CODEXMANAGER_TRACE_QUEUE_CAPACITY", "0");

        assert_eq!(trace_queue_capacity(), 0);
    }

    #[test]
    fn sanitize_text_redacts_base64_image_data_urls() {
        let sanitized = sanitize_text(
            "payload=data:image/png;base64,aGVsbG8= next=data:text/plain;base64,dmFsdWU=",
        );

        assert!(sanitized.contains("data:image/png;base64,<base64 image omitted>"));
        assert!(!sanitized.contains("aGVsbG8="));
        assert!(sanitized.contains("data:text/plain;base64,dmFsdWU="));
    }

    #[test]
    fn sanitize_text_redacts_image_generation_result_payloads() {
        let sanitized = sanitize_text(
            "data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"image_generation_call\",\"result\":\"QUJDREVGRw==\"}}\n\
             data: {\"type\":\"response.image_generation_call.partial_image\",\"partial_image_b64\":\"cGFydA==\"}",
        );

        assert!(sanitized.contains("\"result\":\"<base64 image omitted>\""));
        assert!(sanitized.contains("\"partial_image_b64\":\"<base64 image omitted>\""));
        assert!(!sanitized.contains("QUJDREVGRw=="));
        assert!(!sanitized.contains("cGFydA=="));
    }
}
