# deeddiff

**Local-first desktop tool to redline two versions of an agreement and explain
each change in plain English. No cloud calls — everything runs on your machine.**

deeddiff compares two versions of a contract (DOCX or scanned PDF), renders a
tracked-change **redline**, and for every changed clause asks a **local Ollama**
model for a one-line "what changed and why it matters" note (e.g. _"indemnity cap
removed"_, _"settlement moved from 10 to 5 working days"_).

## How it works

```
 pick Before + After ─┐
                      │  DOCX → bytes
                      │  PDF  → liteparse sidecar (OCR if scanned) → synthesized DOCX
                      ▼
        docxodus (WASM)  compareDocumentsWithLog  ──►  redline + revisions
                      │                                    │
   convertWmlToMarkdown (both sides)                 react-docxodus-viewer
                      │                                  (rendered redline)
            anchor-keyed block diff
                      ▼
            changed clause pairs ──►  local Ollama (/api/chat, JSON schema)
                                          ▼
                              per-clause "what changed / why it matters"
```

- **Redline engine:** [`docxodus`](https://github.com/JSv4/Docxodus) (OpenXML
  tracked-change engine, WASM) + [`react-docxodus-viewer`](https://github.com/JSv4/react-docxodus-viewer).
- **Scanned PDFs:** [`@llamaindex/liteparse`](https://github.com/run-llama/liteparse)
  runs offline OCR as a bundled sidecar; the extracted text is synthesized into a
  DOCX so the same redline engine applies.
- **Explanations:** a local [Ollama](https://ollama.com) model you choose at
  runtime. Only the single changed clause pair is ever sent to it.

## No cloud, by construction

- The WebView runs under a CSP with **no remote origins**.
- All LLM traffic is proxied through the Rust backend to a **hard-coded
  `127.0.0.1:11434`** (not configurable, no env override).
- liteparse OCR is fully offline (bundled Tesseract + bundled language data).

See [`docs/manual-testing.md`](docs/manual-testing.md) for a falsifiable
loopback-only egress test that proves the guarantee.

## Quick start

See [`docs/prerequisites.md`](docs/prerequisites.md) first (Rust + Tauri system
deps, Ollama, the `lit` sidecar, and OCR language data).

```bash
npm install
npm run make-fixtures      # generate sample contract-A/B.docx for trying it out
npm run tauri dev          # launch the app
```

For tests and static checks:

```bash
npm test                   # frontend unit tests (vitest)
npm run typecheck          # tsc
npm run build              # vite production build
( cd src-tauri && cargo test )    # backend unit tests
```

## Known limitations

- When one version is a **scanned PDF**, the rendered redline is reconstructed
  from OCR text and is **best-effort/visual**. The clause-change notes use
  normalized text and are the authoritative description of what changed.
- OCR quality depends on the scan; low-confidence scans are flagged.
- Clause pairing is paragraph/block-level; very large merged/renumbered sections
  may pair coarsely.

## License

MIT for deeddiff itself. Bundled third-party components retain their own licenses
— see [`NOTICES.md`](NOTICES.md).
