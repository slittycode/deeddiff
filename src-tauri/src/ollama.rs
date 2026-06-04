//! Local Ollama client. The base URL is **hard-coded to loopback** and is not
//! configurable (no env override) — this is the structural half of the
//! "no cloud calls" guarantee: even a malicious model name or prompt cannot
//! redirect traffic off-box. Use `127.0.0.1` (not `localhost`) to avoid IPv6
//! `::1` resolution surprises that surface as confusing connection errors.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

use crate::error::CommandError;

pub const OLLAMA_BASE: &str = "http://127.0.0.1:11434";
const CHAT_TIMEOUT: Duration = Duration::from_secs(120);
const TAGS_TIMEOUT: Duration = Duration::from_secs(10);

/// A model the local Ollama daemon has available.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ModelInfo {
    pub name: String,
    /// e.g. "8.0B" — surfaced in the picker so users avoid huge models on laptops.
    pub param_size: Option<String>,
    pub size_bytes: Option<u64>,
}

/// Build the `/api/chat` request body. Pure + unit-tested: it must contain ONLY
/// the single clause pair (in `user`), never full-document text, and it pins the
/// determinism/parsing knobs the UI relies on.
pub fn build_chat_body(model: &str, system: &str, user: &str, schema: Option<Value>) -> Value {
    let mut body = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
        ],
        "stream": false,
        "keep_alive": "30m",
        "options": {
            "temperature": 0,
            "seed": 0,
            "num_predict": 128,
            "num_ctx": 4096
        }
    });
    if let Some(s) = schema {
        body["format"] = s;
    }
    body
}

/// Parse the `/api/tags` response into a model list. Pure + unit-tested.
pub fn parse_models_response(v: &Value) -> Vec<ModelInfo> {
    v.get("models")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    let name = m
                        .get("name")
                        .or_else(|| m.get("model"))
                        .and_then(Value::as_str)?
                        .to_string();
                    Some(ModelInfo {
                        name,
                        param_size: m
                            .get("details")
                            .and_then(|d| d.get("parameter_size"))
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        size_bytes: m.get("size").and_then(Value::as_u64),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Map a reqwest error into a typed, actionable CommandError.
pub fn classify_reqwest_error(e: &reqwest::Error) -> CommandError {
    if e.is_connect() || e.is_timeout() {
        CommandError::OllamaUnreachable(e.to_string())
    } else {
        CommandError::OllamaBadResponse(e.to_string())
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .build()
        .expect("reqwest client builds")
}

/// GET /api/tags. A connection error => Ollama not running (distinct from an
/// empty model list, which the caller treats as "no model pulled").
pub async fn list_models() -> Result<Vec<ModelInfo>, CommandError> {
    list_models_at(OLLAMA_BASE).await
}

/// Implementation of [`list_models`] against an explicit base URL.
///
/// Production code ALWAYS calls [`list_models`], which pins this to the
/// hard-coded loopback [`OLLAMA_BASE`]; there is no runtime, config, or env
/// mechanism that supplies a different base. The parameter exists solely so the
/// HTTP integration tests can point the real `reqwest` stack at a local stub
/// server — it does not weaken the "loopback-only" guarantee.
pub async fn list_models_at(base: &str) -> Result<Vec<ModelInfo>, CommandError> {
    let resp = client()
        .get(format!("{base}/api/tags"))
        .timeout(TAGS_TIMEOUT)
        .send()
        .await
        .map_err(|e| classify_reqwest_error(&e))?;
    let v: Value = resp
        .json()
        .await
        .map_err(|e| CommandError::OllamaBadResponse(e.to_string()))?;
    Ok(parse_models_response(&v))
}

/// POST /api/chat (non-streaming). Returns the assistant message content, which
/// — when a `format` schema is supplied — is a JSON string the UI parses.
pub async fn chat(
    model: &str,
    system: &str,
    user: &str,
    schema: Option<Value>,
) -> Result<String, CommandError> {
    chat_at(OLLAMA_BASE, model, system, user, schema).await
}

/// Implementation of [`chat`] against an explicit base URL. See
/// [`list_models_at`] for why the base is a parameter: production always uses
/// the loopback [`OLLAMA_BASE`]; this seam is for the HTTP integration tests.
pub async fn chat_at(
    base: &str,
    model: &str,
    system: &str,
    user: &str,
    schema: Option<Value>,
) -> Result<String, CommandError> {
    let body = build_chat_body(model, system, user, schema);
    let resp = client()
        .post(format!("{base}/api/chat"))
        .timeout(CHAT_TIMEOUT)
        .json(&body)
        .send()
        .await
        .map_err(|e| classify_reqwest_error(&e))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| CommandError::OllamaBadResponse(e.to_string()))?;

    if status == reqwest::StatusCode::NOT_FOUND || text.contains("not found") {
        return Err(CommandError::ModelNotFound(model.to_string()));
    }
    if !status.is_success() {
        return Err(CommandError::OllamaBadResponse(format!(
            "HTTP {status}: {text}"
        )));
    }

    let v: Value = serde_json::from_str(&text)
        .map_err(|e| CommandError::OllamaBadResponse(e.to_string()))?;
    extract_chat_content(&v)
}

/// Pull `message.content` out of a chat response. Pure + unit-tested.
pub fn extract_chat_content(v: &Value) -> Result<String, CommandError> {
    v.get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| CommandError::OllamaBadResponse("missing message.content".into()))
}

/// Best-effort unload of a model on app exit so deeddiff leaves no resident state.
pub async fn unload(model: &str) {
    let _ = client()
        .post(format!("{OLLAMA_BASE}/api/chat"))
        .timeout(Duration::from_secs(5))
        .json(&json!({ "model": model, "messages": [], "keep_alive": 0 }))
        .send()
        .await;
}

/// Request payload from the renderer for a single clause note.
#[derive(Debug, Deserialize)]
pub struct ChatArgs {
    pub model: String,
    pub system: String,
    pub user: String,
    pub schema: Option<Value>,
}
