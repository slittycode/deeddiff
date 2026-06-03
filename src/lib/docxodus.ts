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
 * clausePairs align cheaply. Object key order preserves document order.
 */
export async function projectBlocks(docx: Uint8Array): Promise<MarkdownBlock[]> {
  await ensureInit();
  const projection = await convertWmlToMarkdown(docx, {
    resolveNumbering: true,
  });
  const anchorIndex = (projection?.anchorIndex ?? {}) as Record<
    string,
    { unid?: string; textPreview?: string }
  >;
  const blocks: MarkdownBlock[] = [];
  for (const [id, target] of Object.entries(anchorIndex)) {
    const text = (target.textPreview ?? "").trim();
    if (!text) continue;
    blocks.push({ unid: target.unid ?? id, text });
  }
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
