//! deeddiff Tauri backend.
//!
//! Responsibilities kept on the Rust side (out of the WebView):
//!   * proxy the local Ollama daemon (so the renderer makes zero network calls
//!     and CORS/CSP never apply to the LLM traffic), and
//!   * run the offline `liteparse` sidecar for PDF/scan ingestion.
//!
//! All DOCX/redline bytes stay in the renderer (docxodus WASM); only OCR *text*
//! crosses the IPC boundary, so we never serialize large `Vec<u8>` as JSON.

pub mod error;
pub mod ollama;
pub mod pdf;

use std::time::Duration;

use error::CommandError;
use ollama::{ChatArgs, ModelInfo};
use pdf::ParseResult;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

const PDF_TIMEOUT: Duration = Duration::from_secs(300);

/// List models the local Ollama daemon has pulled. An `OllamaUnreachable` error
/// means the daemon isn't running; an `Ok` with an empty vec means it's running
/// but no model is pulled — the UI shows different guidance for each.
#[tauri::command]
async fn ollama_list_models() -> Result<Vec<ModelInfo>, CommandError> {
    ollama::list_models().await
}

/// Generate one structured clause note. `args.user` carries ONLY the clause pair.
#[tauri::command]
async fn ollama_chat(args: ChatArgs) -> Result<String, CommandError> {
    ollama::chat(&args.model, &args.system, &args.user, args.schema).await
}

/// Best-effort model unload (frees RAM, leaves no resident state).
#[tauri::command]
async fn ollama_unload(model: String) {
    ollama::unload(&model).await;
}

/// Read a file's raw bytes for the renderer (DOCX → docxodus WASM). Returns a
/// raw byte `Response` (arrives as an ArrayBuffer) rather than a JSON number
/// array, avoiding ~6-10x serialization bloat on multi-MB documents.
#[tauri::command]
async fn read_file(path: String) -> Result<tauri::ipc::Response, CommandError> {
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| CommandError::ResourceMissing(format!("{path}: {e}")))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Write bytes to a user-chosen path (export redline DOCX / notes report).
#[tauri::command]
async fn save_bytes(path: String, data: Vec<u8>) -> Result<(), CommandError> {
    tokio::fs::write(&path, data)
        .await
        .map_err(|e| CommandError::ResourceMissing(format!("{path}: {e}")))
}

/// Parse a PDF via the bundled `lit` sidecar. `ocr=false` extracts the embedded
/// text layer (used both for native PDFs and for the scan-detection probe);
/// `ocr=true` runs Tesseract against the bundled language data.
#[tauri::command]
async fn parse_pdf(
    app: tauri::AppHandle,
    path: String,
    ocr: bool,
    language: Option<String>,
) -> Result<ParseResult, CommandError> {
    let language = language.unwrap_or_else(|| "eng".to_string());
    let args = pdf::build_lit_args(&path, ocr, &language);

    // Point Tesseract at the bundled language data for fully-offline OCR.
    let tessdata = app
        .path()
        .resolve("resources/tessdata", tauri::path::BaseDirectory::Resource)
        .map_err(|e| CommandError::ResourceMissing(e.to_string()))?;

    let command = app
        .shell()
        .sidecar("lit")
        .map_err(|e| CommandError::PdfParseFailed(format!("sidecar not found: {e}")))?
        .args(args)
        .env("TESSDATA_PREFIX", tessdata.to_string_lossy().to_string());

    let output = tokio::time::timeout(PDF_TIMEOUT, command.output())
        .await
        .map_err(|_| CommandError::Timeout("liteparse exceeded 5 minutes".into()))?
        .map_err(|e| CommandError::PdfParseFailed(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(CommandError::PdfParseFailed(format!(
            "lit exited with status {:?}: {stderr}",
            output.status.code()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    pdf::parse_lit_output(&stdout)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ollama_list_models,
            ollama_chat,
            ollama_unload,
            parse_pdf,
            read_file,
            save_bytes
        ])
        .run(tauri::generate_context!())
        .expect("error while running deeddiff");
}
