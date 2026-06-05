import type { NoteState } from "./notes";
import type { ComparedItem, DocumentComparison } from "./documentDiff";

const STATUS_LABEL: Record<ComparedItem["status"], string> = {
  same: "Unchanged",
  added: "Added",
  removed: "Removed",
  modified: "Modified",
  moved: "Moved",
  format: "Formatting",
};

/**
 * Deterministic, AI-free Markdown report of the full comparison: a summary line
 * plus every changed item with its before/after text. Optional `notes` (when the
 * AI bonus is enabled) are folded in per item but are never required.
 */
export function buildComparisonReport(
  comparison: DocumentComparison,
  meta: { nameA: string; nameB: string; notes?: Record<string, NoteState> }
): string {
  const { items, summary } = comparison;
  const lines: string[] = [
    `# deeddiff comparison report`,
    ``,
    `**Before:** ${meta.nameA}  `,
    `**After:** ${meta.nameB}  `,
    ``,
    summary.identical
      ? `**Result:** the documents are identical — no changes detected.`
      : `**Result:** ${summary.changed} change(s) across ${summary.totalAfter} block(s).`,
    ``,
    `| Status | Count |`,
    `| --- | --- |`,
    `| Unchanged | ${summary.same} |`,
    `| Added | ${summary.added} |`,
    `| Removed | ${summary.removed} |`,
    `| Modified | ${summary.modified} |`,
    `| Moved | ${summary.moved} |`,
    `| Formatting | ${summary.format} |`,
    ``,
  ];

  if (summary.identical) return lines.join("\n");

  lines.push(`## Changes`, ``);
  let n = 0;
  for (const item of items) {
    if (item.status === "same") continue;
    n++;
    lines.push(`### ${n}. ${STATUS_LABEL[item.status]}`);
    const note = meta.notes?.[item.unid];
    if (note?.status === "done") {
      lines.push(`- **What changed:** ${note.note.summary}`);
      lines.push(`- **Why it matters:** ${note.note.whyItMatters}`);
    }
    if (item.detail) lines.push(`- ${item.detail}`);
    if (item.before) lines.push(``, `> **Before:** ${item.before}`);
    if (item.after && item.after !== item.before) lines.push(``, `> **After:** ${item.after}`);
    lines.push(``);
  }

  return lines.join("\n");
}

