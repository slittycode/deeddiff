import { diffArrays, diffWords } from "diff";
import type { ChangeKind, ClausePair, MarkdownBlock, Revision } from "./types";

/** Normalize text for matching: case/whitespace/punctuation-insensitive. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[‘’“”]/g, "'")
    .replace(/[–—]/g, "-")
    .trim();
}

/**
 * Sørensen–Dice similarity over word tokens (0 = nothing in common, 1 = same
 * words). Used to decide, within a changed region, which removed clause a given
 * added clause is a *modification of* — rather than pairing positionally, which
 * mislabels an independent removal + addition as a single edit.
 */
export function similarity(a: string, b: string): number {
  const ta = normalizeForMatch(a).split(" ").filter(Boolean);
  const tb = normalizeForMatch(b).split(" ").filter(Boolean);
  if (ta.length === 0 && tb.length === 0) return 1;
  if (ta.length === 0 || tb.length === 0) return 0;
  const countA = new Map<string, number>();
  for (const t of ta) countA.set(t, (countA.get(t) ?? 0) + 1);
  const countB = new Map<string, number>();
  for (const t of tb) countB.set(t, (countB.get(t) ?? 0) + 1);
  let inter = 0;
  for (const [t, c] of countA) inter += Math.min(c, countB.get(t) ?? 0);
  return (2 * inter) / (ta.length + tb.length);
}

/**
 * A removed clause and an added clause are treated as the same clause modified
 * only when they share at least this fraction of their words. Below it, they are
 * independent (one removed, one added).
 */
export const SIMILARITY_THRESHOLD = 0.4;

/**
 * Deterministic, AI-free document comparison.
 *
 * Where `buildClausePairs` returns only the *changed* clauses (the payloads for
 * the optional LLM notes), `compareBlocks` returns a **complete** classification
 * of every block — the items that are the SAME and the items that are not —
 * which is the program's authoritative answer. It uses nothing but the
 * content-addressable unid alignment, a word-level text diff, and the engine's
 * tracked-change revisions. No model, no network.
 */

export type ItemStatus = "same" | "added" | "removed" | "modified" | "moved" | "format";

/** A word-level diff segment for a modified/moved item (deterministic). */
export interface DiffSegment {
  value: string;
  type: "equal" | "insert" | "delete";
}

/** One block's classification in the compared document. */
export interface ComparedItem {
  /** Block anchor unid (or a synthetic id for format-only items). */
  unid: string;
  status: ItemStatus;
  before: string;
  after: string;
  /** Human-readable detail for moved/format items. */
  detail?: string;
  /** Word-level before→after diff, present for `modified` and `moved` items. */
  segments?: DiffSegment[];
}

export interface ComparisonSummary {
  same: number;
  added: number;
  removed: number;
  modified: number;
  moved: number;
  format: number;
  /** added + removed + modified + moved + format. */
  changed: number;
  /** Block counts in each version (for "X of Y unchanged" style reporting). */
  totalBefore: number;
  totalAfter: number;
  /** True iff there are no changes of any kind — the documents match. */
  identical: boolean;
}

export interface DocumentComparison {
  /** Every block, in document order, classified same/added/removed/modified/moved,
   *  followed by any format-only changes. */
  items: ComparedItem[];
  summary: ComparisonSummary;
}

/** Word-level before→after segments via `diffWords` (purely textual). */
export function wordSegments(before: string, after: string): DiffSegment[] {
  return diffWords(before, after).map((p) => ({
    value: p.value,
    type: p.added ? "insert" : p.removed ? "delete" : "equal",
  }));
}

/**
 * Classify both documents into same/changed items. Mirrors the alignment in
 * `buildClausePairs` (unid-keyed `diffArrays`, positional N:M pairing of changed
 * runs, move collapse, format-change append) but also emits one `same` item per
 * unchanged block and attaches word-level segments to modified/moved items.
 */
export function compareBlocks(
  origBlocks: MarkdownBlock[],
  modBlocks: MarkdownBlock[],
  revisions: Revision[] = []
): DocumentComparison {
  const origByUnid = new Map(origBlocks.map((b) => [b.unid, b]));
  const modByUnid = new Map(modBlocks.map((b) => [b.unid, b]));

  const parts = diffArrays(
    origBlocks.map((b) => b.unid),
    modBlocks.map((b) => b.unid)
  );

  const items: ComparedItem[] = [];
  let pendingRemoved: MarkdownBlock[] = [];
  let pendingAdded: MarkdownBlock[] = [];

  const flushChanged = () => {
    if (pendingRemoved.length === 0 && pendingAdded.length === 0) return;

    // Pair each added clause with the most similar removed clause (greedily,
    // best matches first) above the threshold; the rest are genuine adds/removes.
    const matchByAdded = matchBySimilarity(pendingRemoved, pendingAdded);
    const matchedRemoved = new Set(matchByAdded.values());

    // Emit in "after" document order: modified where matched, else added…
    pendingAdded.forEach((after, a) => {
      const r = matchByAdded.get(a);
      if (r !== undefined) {
        const before = pendingRemoved[r];
        items.push({
          unid: after.unid,
          status: "modified",
          before: before.text,
          after: after.text,
          segments: wordSegments(before.text, after.text),
        });
      } else {
        items.push({ unid: after.unid, status: "added", before: "", after: after.text });
      }
    });
    // …then any removed clause with no counterpart.
    pendingRemoved.forEach((before, r) => {
      if (!matchedRemoved.has(r)) {
        items.push({ unid: before.unid, status: "removed", before: before.text, after: "" });
      }
    });

    pendingRemoved = [];
    pendingAdded = [];
  };

  for (const part of parts) {
    if (part.removed) {
      for (const unid of part.value) {
        const blk = origByUnid.get(unid);
        if (blk) pendingRemoved.push(blk);
      }
    } else if (part.added) {
      for (const unid of part.value) {
        const blk = modByUnid.get(unid);
        if (blk) pendingAdded.push(blk);
      }
    } else {
      // An unchanged run closes any open changed region, then emits same items.
      flushChanged();
      for (const unid of part.value) {
        const blk = modByUnid.get(unid) ?? origByUnid.get(unid);
        if (blk) items.push({ unid: blk.unid, status: "same", before: blk.text, after: blk.text });
      }
    }
  }
  flushChanged();

  const collapsed = collapseMovedItems(items);
  const withFormat = appendFormatItems(collapsed, revisions);
  return {
    items: withFormat,
    summary: summarize(withFormat, origBlocks.length, modBlocks.length),
  };
}

/**
 * Greedily match added→removed by descending similarity (each used once, only
 * above `SIMILARITY_THRESHOLD`). Returns a map of added-index → removed-index.
 */
function matchBySimilarity(
  removed: MarkdownBlock[],
  added: MarkdownBlock[]
): Map<number, number> {
  const candidates: { r: number; a: number; score: number }[] = [];
  for (let r = 0; r < removed.length; r++) {
    for (let a = 0; a < added.length; a++) {
      const score = similarity(removed[r].text, added[a].text);
      if (score >= SIMILARITY_THRESHOLD) candidates.push({ r, a, score });
    }
  }
  candidates.sort((x, y) => y.score - x.score);

  const usedR = new Set<number>();
  const usedA = new Set<number>();
  const map = new Map<number, number>();
  for (const { r, a } of candidates) {
    if (usedR.has(r) || usedA.has(a)) continue;
    usedR.add(r);
    usedA.add(a);
    map.set(a, r);
  }
  return map;
}

/** Merge a removed item + an added item with equal normalized text into a move. */
function collapseMovedItems(items: ComparedItem[]): ComparedItem[] {
  const result: (ComparedItem | null)[] = [...items];
  for (let ri = 0; ri < result.length; ri++) {
    const removed = result[ri];
    if (!removed || removed.status !== "removed") continue;
    const norm = normalizeForMatch(removed.before);
    if (!norm) continue;
    const ai = result.findIndex(
      (p) => p != null && p.status === "added" && normalizeForMatch(p.after) === norm
    );
    if (ai >= 0) {
      const added = result[ai]!;
      result[ai] = {
        unid: added.unid,
        status: "moved",
        before: removed.before,
        after: added.after,
        detail: "Clause moved to a new location",
        segments: wordSegments(removed.before, added.after),
      };
      result[ri] = null;
    }
  }
  return result.filter((x): x is ComparedItem => x != null);
}

/** Append format-only changes (no text delta, so invisible to the text diff). */
function appendFormatItems(items: ComparedItem[], revisions: Revision[]): ComparedItem[] {
  const fmt: ComparedItem[] = revisions
    .filter((r) => r.revisionType === "FormatChanged")
    .map((r, i) => {
      const props = r.formatChange?.changedPropertyNames ?? [];
      return {
        unid: `format-${i}`,
        status: "format" as const,
        before: r.text,
        after: r.text,
        detail: props.length ? `Formatting changed: ${props.join(", ")}` : "Formatting changed",
      };
    });
  return [...items, ...fmt];
}

/**
 * The changed items as `ClausePair`s — the payloads for the optional AI notes.
 * The pair `id` is the item `unid`, so a note maps back to its comparison item.
 * (`same` items are dropped; everything else maps 1:1.)
 */
export function changedClausePairs(comparison: DocumentComparison): ClausePair[] {
  return comparison.items
    .filter((i) => i.status !== "same")
    .map((i) => ({
      id: i.unid,
      kind: i.status as ChangeKind,
      before: i.before,
      after: i.after,
      detail: i.detail,
    }));
}

function summarize(
  items: ComparedItem[],
  totalBefore: number,
  totalAfter: number
): ComparisonSummary {
  const counts = { same: 0, added: 0, removed: 0, modified: 0, moved: 0, format: 0 };
  for (const it of items) counts[it.status]++;
  const changed = counts.added + counts.removed + counts.modified + counts.moved + counts.format;
  return { ...counts, changed, totalBefore, totalAfter, identical: changed === 0 };
}
