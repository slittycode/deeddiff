//! HTTP integration tests for the Ollama client.
//!
//! These drive the REAL `reqwest` stack (request encoding, status handling,
//! body/JSON parsing, and error classification) against a minimal in-process
//! HTTP server bound to an ephemeral loopback port. This is the automated
//! counterpart to the manual "talk to a live Ollama daemon" checklist — without
//! needing Ollama installed.
//!
//! The client's production entry points (`list_models`, `chat`) are hard-pinned
//! to `127.0.0.1:11434`; the tests call the `*_at` variants so they can target
//! the stub server's port. See the doc comments in `ollama.rs`.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc::{self, Receiver};
use std::thread;

use deeddiff_lib::error::CommandError;
use deeddiff_lib::ollama;
use serde_json::json;

/// What the client sent us: (method, path, body).
type CapturedRequest = (String, String, String);

/// Bind an ephemeral loopback port and serve exactly one HTTP request with the
/// given status + JSON body. Returns the base URL and a receiver carrying the
/// request the client made (so the test can assert on it after the call).
fn serve_once(status: u16, resp_body: &str) -> (String, Receiver<CapturedRequest>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = mpsc::channel();
    let body = resp_body.to_string();

    thread::spawn(move || {
        let (mut stream, _) = match listener.accept() {
            Ok(pair) => pair,
            Err(_) => return,
        };

        // Read until the end of the header block, then drain the body per
        // Content-Length so the client's write completes cleanly.
        let mut buf = Vec::new();
        let mut chunk = [0u8; 1024];
        let header_end = loop {
            match stream.read(&mut chunk) {
                Ok(0) => break buf.len(),
                Ok(n) => {
                    buf.extend_from_slice(&chunk[..n]);
                    if let Some(pos) = find(&buf, b"\r\n\r\n") {
                        break pos + 4;
                    }
                }
                Err(_) => break buf.len(),
            }
        };

        let head = String::from_utf8_lossy(&buf[..header_end.min(buf.len())]).to_string();
        let mut req_line = head.lines().next().unwrap_or("").split_whitespace();
        let method = req_line.next().unwrap_or("").to_string();
        let path = req_line.next().unwrap_or("").to_string();
        let content_length = head
            .lines()
            .find_map(|l| {
                let lower = l.to_ascii_lowercase();
                lower
                    .strip_prefix("content-length:")
                    .map(|v| v.trim().parse::<usize>().unwrap_or(0))
            })
            .unwrap_or(0);

        let mut req_body = buf[header_end.min(buf.len())..].to_vec();
        while req_body.len() < content_length {
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => req_body.extend_from_slice(&chunk[..n]),
                Err(_) => break,
            }
        }

        let _ = tx.send((method, path, String::from_utf8_lossy(&req_body).to_string()));

        let reason = match status {
            200 => "OK",
            404 => "Not Found",
            500 => "Internal Server Error",
            _ => "OK",
        };
        let response = format!(
            "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
    });

    (format!("http://127.0.0.1:{port}"), rx)
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

#[tokio::test]
async fn list_models_at_parses_a_live_tags_response() {
    let body = json!({
        "models": [
            { "name": "llama3.1:8b", "size": 4_920_000_000u64,
              "details": { "parameter_size": "8.0B", "quantization_level": "Q4_0" } },
            { "model": "qwen2.5:7b", "size": 4_700_000_000u64 }
        ]
    })
    .to_string();
    let (url, rx) = serve_once(200, &body);

    let models = ollama::list_models_at(&url).await.expect("models parse");

    assert_eq!(models.len(), 2);
    assert_eq!(models[0].name, "llama3.1:8b");
    assert_eq!(models[0].param_size.as_deref(), Some("8.0B"));
    assert_eq!(models[1].name, "qwen2.5:7b");

    let (method, path, _) = rx.recv().unwrap();
    assert_eq!(method, "GET");
    assert_eq!(path, "/api/tags");
}

#[tokio::test]
async fn chat_at_sends_the_clause_pair_and_returns_the_content() {
    // Ollama returns the structured note as a JSON *string* in message.content.
    let inner = r#"{"summary":"Indemnity cap removed","materiality":"high"}"#;
    let body = json!({ "message": { "role": "assistant", "content": inner } }).to_string();
    let (url, rx) = serve_once(200, &body);

    let schema = json!({ "type": "object" });
    let content = ollama::chat_at(
        &url,
        "llama3.1:8b",
        "system prompt",
        "BEFORE: cap $1,000,000\nAFTER: cap removed",
        Some(schema),
    )
    .await
    .expect("chat ok");

    assert_eq!(content, inner);

    // The request that actually went over the socket carries the determinism
    // knobs and the single clause pair — nothing else.
    let (method, path, req_body) = rx.recv().unwrap();
    assert_eq!(method, "POST");
    assert_eq!(path, "/api/chat");
    assert!(req_body.contains("\"stream\":false"));
    assert!(req_body.contains("\"temperature\":0"));
    assert!(req_body.contains("cap $1,000,000"));
    assert!(req_body.contains("\"format\""));
}

#[tokio::test]
async fn chat_at_maps_http_404_to_model_not_found() {
    let (url, _rx) = serve_once(404, r#"{"error":"model 'ghost' not found"}"#);
    let err = ollama::chat_at(&url, "ghost", "s", "u", None)
        .await
        .unwrap_err();
    assert!(matches!(err, CommandError::ModelNotFound(m) if m == "ghost"));
}

#[tokio::test]
async fn chat_at_maps_not_found_body_even_with_200() {
    // Some Ollama builds answer 200 with a "not found" error body.
    let (url, _rx) = serve_once(200, r#"{"error":"model not found, pull it first"}"#);
    let err = ollama::chat_at(&url, "ghost", "s", "u", None)
        .await
        .unwrap_err();
    assert!(matches!(err, CommandError::ModelNotFound(_)));
}

#[tokio::test]
async fn chat_at_maps_non_json_200_to_bad_response() {
    let (url, _rx) = serve_once(200, "this is not json");
    let err = ollama::chat_at(&url, "m", "s", "u", None)
        .await
        .unwrap_err();
    assert!(matches!(err, CommandError::OllamaBadResponse(_)));
}

#[tokio::test]
async fn list_models_at_maps_connection_refused_to_unreachable() {
    // Reserve then release a port so nothing is listening on it.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let url = format!("http://127.0.0.1:{port}");

    let err = ollama::list_models_at(&url).await.unwrap_err();
    assert!(matches!(err, CommandError::OllamaUnreachable(_)));
}
