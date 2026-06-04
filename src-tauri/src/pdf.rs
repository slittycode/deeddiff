//! PDF ingestion via the bundled `liteparse` (`lit`) sidecar. Runs fully offline:
//! the Tesseract engine is compiled into the binary, and we point it at the
//! bundled `eng.traineddata` via `TESSDATA_PREFIX`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::CommandError;

/// A text fragment with its bounding box, mirroring liteparse's JSON. Geometry
/// (x/y/width/height/fontSize) lets the renderer reconstruct paragraph and
/// heading boundaries instead of naively splitting on newlines.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TextItem {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default, rename = "fontName")]
    pub font_name: Option<String>,
    #[serde(default, rename = "fontSize")]
    pub font_size: Option<f64>,
    /// OCR confidence (present for scanned pages); used to warn about poor scans.
    #[serde(default)]
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParsedPage {
    #[serde(rename = "pageNum")]
    pub page_num: u32,
    #[serde(default)]
    pub width: f64,
    #[serde(default)]
    pub height: f64,
    #[serde(default)]
    pub text: String,
    #[serde(default, rename = "textItems")]
    pub text_items: Vec<TextItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParseResult {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub pages: Vec<ParsedPage>,
}

/// Parse `lit ... --format json` stdout. Pure + unit-tested against a fixture so
/// the schema contract is locked without spawning the real sidecar in CI.
pub fn parse_lit_output(stdout: &str) -> Result<ParseResult, CommandError> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err(CommandError::PdfParseFailed("liteparse produced no output".into()));
    }
    // `--quiet` should keep stdout pure JSON, but be defensive: take from the
    // first `{` in case any banner leaks through.
    let start = trimmed.find('{').unwrap_or(0);
    let json = &trimmed[start..];
    let v: Value = serde_json::from_str(json)
        .map_err(|e| CommandError::PdfParseFailed(format!("invalid JSON: {e}")))?;
    serde_json::from_value(v)
        .map_err(|e| CommandError::PdfParseFailed(format!("unexpected schema: {e}")))
}

/// Build the sidecar argument vector for a parse run. Pure + unit-tested.
pub fn build_lit_args(path: &str, ocr: bool, language: &str) -> Vec<String> {
    let mut args = vec![
        "parse".to_string(),
        path.to_string(),
        "--format".to_string(),
        "json".to_string(),
        "--quiet".to_string(),
    ];
    if ocr {
        args.push("--ocr-language".to_string());
        args.push(language.to_string());
        args.push("--dpi".to_string());
        args.push("300".to_string());
    } else {
        args.push("--no-ocr".to_string());
    }
    args
}
