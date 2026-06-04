// Thin wrapper around the docxodus WASM engine. This is the boundary to the
// .NET-WASM runtime and is exercised by manual/integration testing rather than
// unit tests (the pure pairing logic lives in clausePairs.ts).
//
// NOTE: the docxodus package ships its own TypeScript types; we keep this file
// permissive (the API surface was verified from source: see the plan).
import {
  initialize,
  isInitialized,
  compareDocuments,
  getRevisions,
  convertWmlToMarkdown,
} from "docxodus";
import type { MarkdownBlock, Revision } from "./types";

let initPromise: Promise<void> | null = null;

/** Initialize the WASM runtime once, pointing at the locally-served assets. */
export async function ensureInit(wasmBasePath = "/wasm/"): Promise<void> {
  if (isInitialized?.()) return;
  if (!initPromise) {
    initPromise = Promise.resolve(initialize(wasmBasePath)).then(() => undefined);
  }
  return initPromise;
}

export interface CompareResult {
  /** Redlined DOCX with tracked changes. */
  redline: Uint8Array;
  revisions: Revision[];
}

/**
 * Compare two DOCX byte arrays, returning the redline and its revisions.
 * `compareDocuments` yields the redlined bytes; revisions (incl. moves and
 * format-only changes) come from `getRevisions` on that redline.
 */
export async function compare(
  orig: Uint8Array,
  mod: Uint8Array,
  authorName = "deeddiff"
): Promise<CompareResult> {
  await ensureInit();
  const redline = await compareDocuments(orig, mod, { authorName });
  const revisions = (await getRevisions(redline)) as unknown as Revision[];
  return { redline, revisions };
}

/**
 * Project a DOCX to anchor-addressed markdown and return ordered blocks. Unids
 * are stable across documents for unchanged content, which is what lets
 * clausePairs align cheaply.
 *
 * The block text comes from the markdown body (the *full* text), NOT the
 * `anchorIndex[id].textPreview`, which the engine documents as only "the first
 * ~80 characters" — using the preview silently truncates long clauses before
 * they reach the diff and the LLM.
 */
export async function projectBlocks(docx: Uint8Array): Promise<MarkdownBlock[]> {
  await ensureInit();
  const projection = await convertWmlToMarkdown(docx, {
    resolveNumbering: true,
  });
  const markdown = projection?.markdown ?? "";
  const anchorIndex = (projection?.anchorIndex ?? {}) as Record<string, { unid?: string }>;
  return parseMarkdownBlocks(markdown, anchorIndex);
}

const ANCHOR_RE = /^\{#([^}]+)\}\s?(.*)$/;
const HEADING_RE = /^#{1,6}\s+/;

/**
 * Parse docxodus block-anchored markdown into ordered, full-text blocks. Each
 * block element is rendered as `{#<id>} <text…>` on its own line (the default
 * `AnchorRenderMode.Block`), blank-line separated; a block's full text may span
 * several lines. `id` maps to a content-addressable `unid` via the anchor index
 * (so unchanged blocks share a unid across documents). Pure — unit-tested
 * without the WASM runtime.
 */
export function parseMarkdownBlocks(
  markdown: string,
  anchorIndex: Record<string, { unid?: string }> = {}
): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let id: string | null = null;
  let parts: string[] = [];

  const flush = () => {
    if (id !== null) {
      const text = parts.join(" ").replace(/\s+/g, " ").trim();
      if (text) blocks.push({ unid: anchorIndex[id]?.unid ?? id, text });
    }
    id = null;
    parts = [];
  };

  for (const line of markdown.split("\n")) {
    const m = line.match(ANCHOR_RE);
    if (m) {
      flush();
      id = m[1];
      parts = [m[2].replace(HEADING_RE, "")];
    } else if (id !== null) {
      if (line.trim() === "") flush();
      else parts.push(line.replace(HEADING_RE, ""));
    }
  }
  flush();
  return blocks;
}

/** Wrap redline bytes as a File for <DocumentViewer file=…>. */
export function redlineToFile(bytes: Uint8Array, name = "redline.docx"): File {
  // Copy into a fresh ArrayBuffer-backed view so the BlobPart type is concrete
  // (avoids the ArrayBufferLike/SharedArrayBuffer lib-DOM friction).
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  return new File([blob], name, { type: blob.type });
}
