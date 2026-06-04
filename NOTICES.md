# Third-party notices

deeddiff bundles and depends on the following components, each under its own
license. This file is a pointer; consult each project for the authoritative text.

| Component | Role in deeddiff | License (verify upstream) |
|-----------|------------------|---------------------------|
| [docxodus](https://github.com/JSv4/Docxodus) | OpenXML redline engine (WASM) + markdown projection | See repository |
| [react-docxodus-viewer](https://github.com/JSv4/react-docxodus-viewer) | Redline rendering component | See repository |
| [@llamaindex/liteparse](https://github.com/run-llama/liteparse) | Offline PDF/OCR sidecar | See repository |
| Tesseract OCR (bundled in liteparse) | OCR engine | Apache-2.0 |
| Tesseract `eng.traineddata` | OCR language model | Apache-2.0 (tessdata) |
| PDFium (bundled in liteparse) | PDF rendering | BSD-3-Clause |
| [docx](https://github.com/dolanmiu/docx) | DOCX synthesis from OCR text | MIT |
| [diff](https://github.com/kpdecker/jsdiff) | Block/word alignment | BSD-3-Clause |
| [Tauri](https://tauri.app) | Desktop shell | MIT / Apache-2.0 |
| [React](https://react.dev) | UI | MIT |
| [Ollama](https://ollama.com) | Local LLM runtime (external, not bundled) | MIT |

> When producing distributable bundles, regenerate this list against the exact
> pinned versions and include each component's full license text as required.
