import { invoke } from "@tauri-apps/api/core";
import type { FileKind, VersionInput } from "./types";
import { buildDocxFromPages, type LiteParseResult } from "./buildDocx";

/** Average non-whitespace characters per page below which we treat a PDF as a scan. */
const SCAN_TEXT_DENSITY_THRESHOLD = 100;

/** Classify a picked file by extension. */
export function routeFile(name: string): FileKind | "reject" {
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pdf")) return "pdf";
  return "reject";
}

/** Decide whether a parsed PDF is a scan (sparse embedded text => needs OCR). */
export function isLikelyScan(parsed: LiteParseResult): boolean {
  const pages = parsed.pages?.length ?? 0;
  if (pages === 0) return true;
  const nonWs = (parsed.text ?? "").replace(/\s+/g, "").length;
  return nonWs / pages < SCAN_TEXT_DENSITY_THRESHOLD;
}

/** Clean up common OCR artifacts before the text feeds a diff. */
export function normalizeOcrText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/­/g, "") // soft hyphen
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface IngestResult {
  /** DOCX bytes ready for docxodus compare. */
  docx: Uint8Array;
  /** True if this side came from OCR — the rendered redline is then best-effort. */
  fromOcr: boolean;
  /** Set when OCR produced little/no text, so the caller can warn the user. */
  emptyText?: boolean;
}

/**
 * Turn a selected version into DOCX bytes. DOCX passes through; PDF is parsed
 * (embedded-text probe first), and only OCR'd if it looks like a scan.
 */
export async function ingestVersion(
  input: VersionInput,
  readBytes: (path: string) => Promise<Uint8Array>
): Promise<IngestResult> {
  if (input.kind === "docx") {
    return { docx: await readBytes(input.path), fromOcr: false };
  }

  // Probe with the embedded text layer (no OCR).
  const probe = await invoke<LiteParseResult>("parse_pdf", {
    path: input.path,
    ocr: false,
  });

  let parsed = probe;
  let fromOcr = false;
  if (isLikelyScan(probe)) {
    parsed = await invoke<LiteParseResult>("parse_pdf", {
      path: input.path,
      ocr: true,
    });
    fromOcr = true;
  }

  const text = normalizeOcrText(parsed.text ?? "");
  const docx = await buildDocxFromPages(parsed.pages ?? []);
  return { docx, fromOcr, emptyText: text.length === 0 };
}
