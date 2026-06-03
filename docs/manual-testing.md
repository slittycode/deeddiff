# Manual testing checklist

Automated tests (vitest + `cargo test`) cover the pure logic. The items below
need the real GUI/WASM/Ollama/sidecar and so are verified by hand.

## Setup

```bash
npm install
npm run make-fixtures          # tests/fixtures/contract-A.docx, contract-B.docx
ollama serve &                 # in another shell, with a model pulled
npm run tauri dev
```

## Core flows

- [ ] **DOCX ↔ DOCX**: load `contract-A.docx` (Before) and `contract-B.docx`
      (After). The redline renders with tracked changes. The notes panel shows:
      indemnity cap removed (high), 10→5 working days, termination clause removed,
      confidentiality clause added.
- [ ] **DOCX ↔ scanned PDF**: After = a scanned PDF. OCR runs (progress shown),
      a redline renders, the "best-effort redline / authoritative notes" warning
      appears.
- [ ] **PDF ↔ PDF** (both scans): two sidecar OCR passes, redline renders.
- [ ] **Identical files**: pick the same file for both → "No changes detected".
- [ ] **Swap A↔B**: redline direction flips (insertions ↔ deletions).
- [ ] **Reject**: choosing a `.txt`/`.doc`/image is refused.

## Notes panel

- [ ] **Note ↔ clause linkage**: click a note row → the viewer scrolls to and
      highlights that clause. _(Top UX risk: confirm anchor text is findable in
      the rendered DOM; otherwise the highlight won't fire.)_
- [ ] **Materiality**: notes are ordered high→none; `none` rows are dimmed.
- [ ] **Per-row error + retry**: with Ollama stopped mid-run, a row shows an
      error and the **Retry** button re-runs just that clause.
- [ ] **Re-run/cancel**: pressing Compare again abandons in-flight notes (no
      stale rows from the previous run).

## Environment states

- [ ] **Ollama not running**: model selector shows "Ollama isn't running" with a
      retry.
- [ ] **No model pulled**: selector shows the `ollama pull` guidance.
- [ ] **Sidecar missing**: a PDF parse surfaces a clear "sidecar not found" error.
- [ ] **Old WebView**: on WebKitGTK < 2.40, the app shows the SIMD-unsupported
      screen instead of a blank viewer.

## Exports

- [ ] **Export redline** writes a valid `.docx` that opens in Word/LibreOffice
      with tracked changes intact.
- [ ] **Export report** writes a Markdown file listing each change + note.

## No-cloud proof (do this once)

Run the app with all non-loopback egress blocked and confirm full functionality
plus **zero** off-box connections during a complete DOCX + scanned-PDF + notes
run (this exercises the `lit` sidecar under deny too).

Linux (nftables), as root:

```bash
nft add table inet deeddiff_test
nft add chain inet deeddiff_test out '{ type filter hook output priority 0 ; }'
nft add rule  inet deeddiff_test out oifname "lo" accept
nft add rule  inet deeddiff_test out ip daddr 127.0.0.0/8 accept
nft add rule  inet deeddiff_test out ip6 daddr ::1 accept
nft add rule  inet deeddiff_test out reject
# run a full deeddiff session here, then:
nft delete table inet deeddiff_test
```

Or observe live: `sudo lsof -i -nP | grep -i deeddiff` should show connections
only to `127.0.0.1:11434`.
