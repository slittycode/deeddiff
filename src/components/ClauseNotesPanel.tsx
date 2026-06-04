import type { ClausePair, Materiality } from "../lib/types";
import type { NoteState } from "../lib/notes";

interface Props {
  pairs: ClausePair[];
  notes: NoteState[];
  onSelect: (pair: ClausePair) => void;
  onRetry: (index: number) => void;
}

const MATERIALITY_ORDER: Record<Materiality, number> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
};

function kindLabel(kind: ClausePair["kind"]): string {
  return { added: "Added", removed: "Removed", modified: "Changed", moved: "Moved", format: "Format" }[
    kind
  ];
}

export function ClauseNotesPanel({ pairs, notes, onSelect, onRetry }: Props) {
  if (pairs.length === 0) {
    return <div className="notes-empty">No changes detected between the two versions.</div>;
  }

  // Render in materiality order once notes resolve, falling back to source order.
  const order = pairs
    .map((pair, index) => ({ pair, index }))
    .sort((a, b) => {
      const na = notes[a.index];
      const nb = notes[b.index];
      const ma = na?.status === "done" ? MATERIALITY_ORDER[na.note.materiality] : 1.5;
      const mb = nb?.status === "done" ? MATERIALITY_ORDER[nb.note.materiality] : 1.5;
      return ma - mb || a.index - b.index;
    });

  return (
    <div className="notes-panel">
      <h2>Changes ({pairs.length})</h2>
      {order.map(({ pair, index }) => {
        const state = notes[index];
        const note = state?.status === "done" ? state.note : null;
        const dim = note?.materiality === "none";
        return (
          <div
            key={pair.id + index}
            className={`note-row ${dim ? "dim" : ""}`}
            onClick={() => onSelect(pair)}
          >
            <div className="note-head">
              <span className={`badge kind-${pair.kind}`}>{kindLabel(pair.kind)}</span>
              {note && (
                <span className={`badge mat-${note.materiality}`}>{note.materiality}</span>
              )}
              {note && <span className="badge cat">{note.category}</span>}
            </div>

            {state?.status === "pending" && <div className="note-body muted">Analyzing…</div>}
            {state?.status === "error" && (
              <div className="note-body error">
                {state.message}{" "}
                <button
                  className="link"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetry(index);
                  }}
                >
                  Retry
                </button>
              </div>
            )}
            {note && (
              <div className="note-body">
                <div className="note-summary">{note.summary}</div>
                {note.whyItMatters && <div className="note-why">{note.whyItMatters}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
