use serde::Serialize;

/// A serializable, frontend-actionable error. The `kind` discriminator lets the
/// UI show the right recovery guidance (e.g. "Ollama isn't running" vs
/// "that model isn't pulled") instead of a generic failure.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum CommandError {
    /// Could not connect to the local Ollama daemon (connection refused, etc).
    OllamaUnreachable(String),
    /// Ollama responded but the requested model is not pulled locally.
    ModelNotFound(String),
    /// Ollama responded with something unexpected / unparseable.
    OllamaBadResponse(String),
    /// The liteparse sidecar failed to run or produced no parseable output.
    PdfParseFailed(String),
    /// An operation exceeded its time budget.
    Timeout(String),
    /// A path/resource the backend needed could not be resolved.
    ResourceMissing(String),
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CommandError::OllamaUnreachable(m) => write!(f, "ollama unreachable: {m}"),
            CommandError::ModelNotFound(m) => write!(f, "model not found: {m}"),
            CommandError::OllamaBadResponse(m) => write!(f, "bad ollama response: {m}"),
            CommandError::PdfParseFailed(m) => write!(f, "pdf parse failed: {m}"),
            CommandError::Timeout(m) => write!(f, "timed out: {m}"),
            CommandError::ResourceMissing(m) => write!(f, "resource missing: {m}"),
        }
    }
}

impl std::error::Error for CommandError {}
