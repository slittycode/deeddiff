import { diffArrays } from "diff";
import type { ClausePair, MarkdownBlock, Revision } from "./types";

/**
 * Build the list of changed clauses from two anchor-addressed markdown
 * projections plus the tracked-change revisions.
 *
 * Strategy (see the plan's "corrected" clause-pairing notes):
 *   1. Align blocks by their content-addressable Unid — unchanged clauses share
 *      a Unid across both documents, so they align instantly and cheaply.
 *   2. Within the changed (removed+added) runs, pair positionally (N:M) into
 *      modified / added / removed clauses.
 *   3. Collapse moves: a removed-only clause whose normalized text reappears as
 *      an added-only clause is one "moved" clause, not a delete + an add.
 *   4. Append format-only changes from revisions — these carry no text delta and
 *      are therefore invisible to the text diff.
 */
export function buildClausePairs(
  origBlocks: MarkdownBlock[],
  modBlocks: MarkdownBlock[],
  revisions: Revision[] = []
): ClausePair[] {
  const origByUnid = new Map(origBlocks.map((b) => [b.unid, b]));
  const modByUnid = new Map(modBlocks.map((b) => [b.unid, b]));

  const parts = diffArrays(
    origBlocks.map((b) => b.unid),
    modBlocks.map((b) => b.unid)
  );

  const pairs: ClausePair[] = [];
  let pendingRemoved: MarkdownBlock[] = [];
  let pendingAdded: MarkdownBlock[] = [];

  const flush = () => {
    const n = Math.max(pendingRemoved.length, pendingAdded.length);
    for (let i = 0; i < n; i++) {
      const before = pendingRemoved[i];
      const after = pendingAdded[i];
      if (before && after) {
        pairs.push({
          id: after.unid,
          kind: "modified",
          before: before.text,
          after: after.text,
        });
      } else if (before) {
        pairs.push({ id: before.unid, kind: "removed", before: before.text, after: "" });
      } else if (after) {
        pairs.push({ id: after.unid, kind: "added", before: "", after: after.text });
      }
    }
    pendingRemoved = [];
    pendingAdded = [];
  };

  for (const part of parts) {
    if (part.removed) {
      for (const unid of part.value) {
        const b = origByUnid.get(unid);
        if (b) pendingRemoved.push(b);
      }
    } else if (part.added) {
      for (const unid of part.value) {
        const b = modByUnid.get(unid);
        if (b) pendingAdded.push(b);
      }
    } else {
      // An unchanged run closes the current changed region.
      flush();
    }
  }
  flush();

  return appendFormatChanges(collapseMoves(pairs), revisions);
}

/** Normalize text for move detection: case/whitespace/punctuation-insensitive. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s]+/g, " ")
    .replace(/[‘’“”]/g, "'")
    .replace(/[–—]/g, "-")
    .trim();
}

/** Merge a removed-only + added-only pair with equal normalized text into a move. */
export function collapseMoves(pairs: ClausePair[]): ClausePair[] {
  const result = [...pairs];
  const removedIdx = result
    .map((p, i) => (p.kind === "removed" ? i : -1))
    .filter((i) => i >= 0);

  for (const ri of removedIdx) {
    const removed = result[ri];
    if (!removed) continue;
    const norm = normalizeForMatch(removed.before);
    if (!norm) continue;
    const ai = result.findIndex(
      (p) => p.kind === "added" && normalizeForMatch(p.after) === norm
    );
    if (ai >= 0) {
      const added = result[ai];
      result[ai] = {
        id: added.id,
        kind: "moved",
        before: removed.before,
        after: added.after,
        detail: "Clause moved to a new location",
      };
      // Mark the removed entry for deletion.
      result[ri] = null as unknown as ClausePair;
    }
  }
  return result.filter(Boolean);
}

/** Add format-only changes (no text delta, so absent from the text diff). */
export function appendFormatChanges(
  pairs: ClausePair[],
  revisions: Revision[]
): ClausePair[] {
  const formatNotes: ClausePair[] = revisions
    .filter((r) => r.revisionType === "FormatChanged")
    .map((r, i) => {
      const props = r.formatChange?.changedPropertyNames ?? [];
      return {
        id: `format-${i}`,
        kind: "format" as const,
        before: r.text,
        after: r.text,
        detail: props.length ? `Formatting changed: ${props.join(", ")}` : "Formatting changed",
      };
    });
  return [...pairs, ...formatNotes];
}
