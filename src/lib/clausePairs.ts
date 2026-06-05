import type { ClausePair, MarkdownBlock, Revision } from "./types";
import { changedClausePairs, compareBlocks, normalizeForMatch } from "./documentDiff";

// `normalizeForMatch` historically lived here; re-export it so existing imports
// keep working. The real comparison logic now lives in `documentDiff.ts`.
export { normalizeForMatch };

/**
 * The changed clauses between two anchor-addressed projections — the payloads
 * for the optional AI notes. This is a thin view over the authoritative,
 * AI-free `compareBlocks` classification (so there is exactly one diff
 * algorithm): it returns the same/different items with the `same` ones dropped.
 */
export function buildClausePairs(
  origBlocks: MarkdownBlock[],
  modBlocks: MarkdownBlock[],
  revisions: Revision[] = []
): ClausePair[] {
  return changedClausePairs(compareBlocks(origBlocks, modBlocks, revisions));
}
