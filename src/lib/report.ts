import type { ClausePair } from "./types";
import type { NoteState } from "./notes";

/** Build a Markdown change report from clause pairs and their notes. */
export function buildNotesReport(
  pairs: ClausePair[],
  notes: NoteState[],
  meta: { nameA: string; nameB: string; model: string }
): string {
  const lines: string[] = [
    `# deeddiff change report`,
    ``,
    `**Before:** ${meta.nameA}  `,
    `**After:** ${meta.nameB}  `,
    `**Model:** ${meta.model}  `,
    `**Changes:** ${pairs.length}`,
    ``,
  ];

  pairs.forEach((pair, i) => {
    const state = notes[i];
    const note = state?.status === "done" ? state.note : null;
    lines.push(`## ${i + 1}. ${pair.kind.toUpperCase()}`);
    if (note) {
      lines.push(`- **What changed:** ${note.summary}`);
      lines.push(`- **Why it matters:** ${note.whyItMatters}`);
      lines.push(`- **Category:** ${note.category} · **Materiality:** ${note.materiality}`);
    } else if (state?.status === "error") {
      lines.push(`- _(note unavailable: ${state.message})_`);
    }
    if (pair.before) lines.push(``, `> **Before:** ${pair.before}`);
    if (pair.after) lines.push(``, `> **After:** ${pair.after}`);
    lines.push(``);
  });

  return lines.join("\n");
}
