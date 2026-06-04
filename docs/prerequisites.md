# Prerequisites

## 1. Toolchains

- **Node.js** ≥ 20 and npm.
- **Rust** (stable) + Cargo — https://rustup.rs.
- **Tauri v2 system dependencies.** On Debian/Ubuntu:

  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
    libayatana-appindicator3-dev build-essential curl wget file pkg-config
  ```

  > deeddiff renders redlines with WebAssembly **SIMD**, which on Linux requires
  > **WebKitGTK ≥ 2.40** (Ubuntu 22.04+ is fine). The app shows a clear error and
  > refuses to run on older WebViews.

  macOS/Windows: install the Tauri prerequisites per
  https://v2.tauri.app/start/prerequisites/ (Xcode CLT / WebView2).

## 2. Ollama (the local LLM)

1. Install Ollama: https://ollama.com/download
2. Start it: `ollama serve`
3. Pull at least one instruct model, e.g.:

   ```bash
   ollama pull llama3.1      # or: qwen2.5:7b, gemma2:2b, phi3.5
   ```

deeddiff lists whatever models you have installed and lets you pick one at
runtime. It talks to Ollama only on `127.0.0.1:11434`.

## 3. The liteparse (`lit`) sidecar — for scanned PDFs

The npm `lit` is a Node wrapper and is **not** a standalone binary, so we use a
real native binary built from the Rust crate as a Tauri sidecar.

```bash
cargo install liteparse
# locate the produced binary (usually ~/.cargo/bin/lit), then place it as a
# Tauri sidecar named with this machine's target triple:
TRIPLE=$(rustc -vV | sed -n 's/host: //p')
cp "$(command -v lit)" "src-tauri/binaries/lit-${TRIPLE}"
chmod +x "src-tauri/binaries/lit-${TRIPLE}"
```

If `lit` is dynamically linked against PDFium, co-locate the PDFium library with
the binary (or build it statically).

## 4. OCR language data (offline Tesseract)

liteparse bundles the Tesseract engine but **not** the language data. Download
`eng.traineddata` and place it where deeddiff bundles it:

```bash
mkdir -p src-tauri/resources/tessdata
curl -L -o src-tauri/resources/tessdata/eng.traineddata \
  https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata
```

At runtime deeddiff sets `TESSDATA_PREFIX` to this bundled directory, so OCR
works with no network access. Add other languages the same way and select them
in the parse call.

## 5. App icon (for bundling)

`npm run tauri icon path/to/icon.png` generates the icon set referenced by
`tauri.conf.json`. Not needed for `tauri dev` / tests.
