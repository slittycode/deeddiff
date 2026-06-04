//! Backend unit/integration tests for the pure logic that does NOT need a GUI,
//! the WASM runtime, a real Ollama daemon, or the real `lit` sidecar.

use deeddiff_lib::error::CommandError;
use deeddiff_lib::ollama;
use deeddiff_lib::pdf;
use serde_json::json;

// ---------- ollama: request building ----------

#[test]
fn chat_body_contains_only_the_clause_pair_and_pins_determinism() {
    let system = "You compare two versions of one contract clause.";
    let user = "BEFORE:\nindemnity cap $1,000,000\nAFTER:\nindemnity cap removed";
    let body = ollama::build_chat_body("llama3.1:8b", system, user, None);

    assert_eq!(body["model"], "llama3.1:8b");
    assert_eq!(body["stream"], false);
    assert_eq!(body["options"]["temperature"], 0);
    assert_eq!(body["options"]["seed"], 0);
    assert_eq!(body["keep_alive"], "30m");

    // Exactly two messages: system + the single clause-pair user message.
    let messages = body["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["role"], "system");
    assert_eq!(messages[1]["role"], "user");
    assert_eq!(messages[1]["content"], user);
}

#[test]
fn chat_body_attaches_format_schema_when_provided() {
    let schema = json!({ "type": "object", "properties": { "summary": { "type": "string" } } });
    let body = ollama::build_chat_body("m", "s", "u", Some(schema.clone()));
    assert_eq!(body["format"], schema);
}

#[test]
fn parse_models_response_maps_names_and_details() {
    let v = json!({
        "models": [
            { "name": "llama3.1:8b", "size": 4920000000u64,
              "details": { "parameter_size": "8.0B", "quantization_level": "Q4_0" } },
            { "model": "qwen2.5:7b", "size": 4700000000u64 }
        ]
    });
    let models = ollama::parse_models_response(&v);
    assert_eq!(models.len(), 2);
    assert_eq!(models[0].name, "llama3.1:8b");
    assert_eq!(models[0].param_size.as_deref(), Some("8.0B"));
    assert_eq!(models[1].name, "qwen2.5:7b");
    assert_eq!(models[1].param_size, None);
}

#[test]
fn parse_models_response_empty_when_no_models_key() {
    assert!(ollama::parse_models_response(&json!({})).is_empty());
}

#[test]
fn extract_chat_content_reads_message_content() {
    let v = json!({ "message": { "role": "assistant", "content": "{\"summary\":\"x\"}" } });
    assert_eq!(ollama::extract_chat_content(&v).unwrap(), "{\"summary\":\"x\"}");
}

#[test]
fn extract_chat_content_errors_when_missing() {
    let err = ollama::extract_chat_content(&json!({ "done": true })).unwrap_err();
    assert!(matches!(err, CommandError::OllamaBadResponse(_)));
}

// ---------- pdf: sidecar args + output parsing ----------

#[test]
fn lit_args_force_json_and_quiet() {
    let args = pdf::build_lit_args("/tmp/a.pdf", false, "eng");
    assert!(args.windows(2).any(|w| w == ["--format", "json"]));
    assert!(args.contains(&"--quiet".to_string()));
    assert!(args.contains(&"--no-ocr".to_string()));
}

#[test]
fn lit_args_enable_ocr_with_language_and_dpi() {
    let args = pdf::build_lit_args("/tmp/scan.pdf", true, "fra");
    assert!(args.windows(2).any(|w| w == ["--ocr-language", "fra"]));
    assert!(args.windows(2).any(|w| w == ["--dpi", "300"]));
    assert!(!args.contains(&"--no-ocr".to_string()));
}

#[test]
fn parse_lit_output_reads_the_fixture_schema() {
    let stdout = include_str!("fixtures/lit_output.json");
    let result = pdf::parse_lit_output(stdout).unwrap();
    assert_eq!(result.pages.len(), 1);
    let page = &result.pages[0];
    assert_eq!(page.page_num, 1);
    assert_eq!(page.text_items.len(), 3);
    assert_eq!(page.text_items[0].font_size, Some(16.0));
    assert!(result.text.contains("Indemnification"));
}

#[test]
fn parse_lit_output_tolerates_leading_banner_noise() {
    let noisy = "liteparse v2.0.5\n{\"text\":\"hi\",\"pages\":[]}";
    let result = pdf::parse_lit_output(noisy).unwrap();
    assert_eq!(result.text, "hi");
}

#[test]
fn parse_lit_output_errors_on_empty() {
    assert!(matches!(
        pdf::parse_lit_output("   ").unwrap_err(),
        CommandError::PdfParseFailed(_)
    ));
}
