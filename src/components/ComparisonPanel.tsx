import { useState } from "react";
import type { ComparedItem, DiffSegment, DocumentComparison } from "../lib/documentDiff";
import type { NoteState } from "../lib/notes";

interface Props {
  comparison: DocumentComparison;
  /** Optional AI notes keyed by item unid (present only when the AI bonus is on). */
  notes?: Record<string, NoteState>;
  onSelect: (item: ComparedItem) => void;
  onRetry?: (item: ComparedItem) => void;
}

const STATUS_LABEL: Record<ComparedItem["status"], string> = {
  same: "Unchanged",
  added: "Added",
  removed: "Removed",
  modified: "Modified",
  moved: "Moved",
  format: "Formatting",
};

/** Render the word-level before→after diff for modified/moved items. */
function InlineDiff({ segments }: { segments: DiffSegment[] }) {
  return (
    <p className="inline-diff">
      {segments.map((s, i) => (
        <span key={i} className={`seg seg-${s.type}`}>
          {s.value}
        </span>
      ))}
    </p>
  );
}

function ChangedItem({
  item,
  note,
  onSelect,
  onRetry,
}: {
  item: ComparedItem;
  note?: NoteState;
  onSelect: (item: ComparedItem) => void;
  onRetry?: (item: ComparedItem) => void;
}) {
  return (
    <div className={`cmp-row status-${item.status}`} onClick={() => onSelect(item)}>
      <div className="cmp-head">
        <span className={`badge kind-${item.status}`}>{STATUS_LABEL[item.status]}</span>
        {note?.status === "done" && (
          <span className={`badge mat-${note.note.materiality}`}>{note.note.materiality}</span>
        )}
      </div>

      <div className="cmp-body">
        {item.segments ? (
          <InlineDiff segments={item.segments} />
        ) : (
          <>
            {item.before && <p className="cmp-before">− {item.before}</p>}
            {item.after && item.after !== item.before && <p className="cmp-after">＋ {item.after}</p>}
          </>
        )}
        {item.detail && <p className="cmp-detail">{item.detail}</p>}

        {/* Optional AI enrichment — never required for the determination above. */}
        {note?.status === "done" && (
          <div className="note-body">
            <div className="note-summary">{note.note.summary}</div>
            {note.note.whyItMatters && <div className="note-why">{note.note.whyItMatters}</div>}
          </div>
        )}
        {note?.status === "pending" && <div className="note-body muted">Analyzing…</div>}
        {note?.status === "error" && (
          <div className="note-body error">
            {note.message}
            {onRetry && (
              <button
                className="link"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry(item);
                }}
              >
                {" "}
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ComparisonPanel({ comparison, notes, onSelect, onRetry }: Props) {
  const [showSame, setShowSame] = useState(false);
  const { items, summary } = comparison;

  if (summary.identical) {
    return (
      <div className="notes-empty">
        <b>No differences detected.</b>
        <p>The two versions are identical across all {summary.same} blocks.</p>
      </div>
    );
  }

  const changed = items.filter((i) => i.status !== "same");
  const same = items.filter((i) => i.status === "same");

  return (
    <div className="cmp-panel">
      <div className="cmp-summary">
        <strong>{summary.changed} change(s)</strong>
        <span className="cmp-counts">
          {summary.added > 0 && <span className="badge kind-added">+{summary.added}</span>}
          {summary.removed > 0 && <span className="badge kind-removed">−{summary.removed}</span>}
          {summary.modified > 0 && <span className="badge kind-modified">~{summary.modified}</span>}
          {summary.moved > 0 && <span className="badge kind-moved">⇄{summary.moved}</span>}
          {summary.format > 0 && <span className="badge kind-format">¶{summary.format}</span>}
          <span className="badge kind-same">{summary.same} same</span>
        </span>
      </div>

      {changed.map((item) => (
        <ChangedItem
          key={item.unid}
          item={item}
          note={notes?.[item.unid]}
          onSelect={onSelect}
          onRetry={onRetry}
        />
      ))}

      {same.length > 0 && (
        <div className="cmp-same-section">
          <button className="link" onClick={() => setShowSame((v) => !v)}>
            {showSame ? "Hide" : "Show"} {same.length} unchanged block(s)
          </button>
          {showSame &&
            same.map((item) => (
              <div
                key={item.unid}
                className="cmp-row status-same dim"
                onClick={() => onSelect(item)}
              >
                <span className="badge kind-same">Unchanged</span>
                <span className="cmp-same-text">{item.before}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
