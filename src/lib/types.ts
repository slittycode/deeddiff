// Shared types across the deeddiff renderer.

export type FileKind = "docx" | "pdf";

/** A document version the user has selected. */
export interface VersionInput {
  path: string;
  name: string;
  kind: FileKind;
}

/** One block of a docxodus anchor-addressed markdown projection. */
export interface MarkdownBlock {
  /** Content-addressable Unid; identical across documents for unchanged blocks. */
  unid: string;
  text: string;
}

export type RevisionType = "Inserted" | "Deleted" | "Moved" | "FormatChanged";

/** A tracked-change revision returned by docxodus `compareDocumentsWithLog`. */
export interface Revision {
  author: string;
  date: string;
  revisionType: RevisionType;
  text: string;
  moveGroupId?: number;
  isMoveSource?: boolean;
  formatChange?: { changedPropertyNames?: string[] };
}

export type ChangeKind = "added" | "removed" | "modified" | "moved" | "format";

/** A changed clause: the unit we send to the LLM and render a note for. */
export interface ClausePair {
  /** Derives from the block anchor so a note row can map back to the viewer. */
  id: string;
  kind: ChangeKind;
  before: string;
  after: string;
  /** For move/format changes, a human-readable detail (e.g. changed properties). */
  detail?: string;
}

// ---- Structured LLM note (mirrors the Ollama JSON schema) ----

export type Materiality = "none" | "low" | "medium" | "high";

export type Category =
  | "liability"
  | "payment"
  | "term"
  | "termination"
  | "ip"
  | "confidentiality"
  | "governance"
  | "definition"
  | "formatting"
  | "other";

export interface ClauseNote {
  summary: string;
  whyItMatters: string;
  category: Category;
  materiality: Materiality;
  direction: "added" | "removed" | "modified" | "moved";
}

export interface ModelInfo {
  name: string;
  param_size?: string | null;
  size_bytes?: number | null;
}
