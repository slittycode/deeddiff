import { useCallback, useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { ClausePair, VersionInput } from "./lib/types";
import { compare, projectBlocks, redlineToFile } from "./lib/docxodus";
import {
  compareBlocks,
  changedClausePairs,
  type ComparedItem,
  type DocumentComparison,
} from "./lib/documentDiff";
import { ingestVersion } from "./lib/ingest";
import { readBytes, saveBytes } from "./lib/platform";
import { generateNotes, errorMessage, type GenerateHandle, type NoteState } from "./lib/notes";
import { requestNote, unloadModel } from "./lib/ollama";
import { buildComparisonReport } from "./lib/report";
import { hasWasmSimd } from "./lib/wasmCheck";

import { VersionPicker } from "./components/VersionPicker";
import { ModelSelector } from "./components/ModelSelector";
import { RedlineViewer } from "./components/RedlineViewer";
import { ComparisonPanel } from "./components/ComparisonPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";

type Stage =
  | { name: "idle" }
  | { name: "ingesting"; which: "before" | "after" }
  | { name: "comparing" }
  | { name: "pairing" }
  | { name: "generating"; done: number; total: number }
  | { name: "ready" }
  | { name: "error"; message: string };

const TEXT_ENCODER = new TextEncoder();

export default function App() {
  const simdOk = hasWasmSimd();

  // AI notes are an optional bonus, off by default: the comparison itself is
  // fully deterministic and never needs a model.
  const [aiEnabled, setAiEnabled] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [before, setBefore] = useState<VersionInput | null>(null);
  const [after, setAfter] = useState<VersionInput | null>(null);

  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [redlineFile, setRedlineFile] = useState<File | null>(null);
  const [redlineBytes, setRedlineBytes] = useState<Uint8Array | null>(null);
  const [comparison, setComparison] = useState<DocumentComparison | null>(null);
  const [notes, setNotes] = useState<Record<string, NoteState>>({});
  const [warning, setWarning] = useState<string | null>(null);

  const runEpoch = useRef(0);
  const noteHandle = useRef<GenerateHandle | null>(null);
  // The changed clause pairs from the last run, indexed for note retry.
  const changedPairs = useRef<ClausePair[]>([]);

  // Keep the window title in sync with the loaded versions.
  useEffect(() => {
    const title =
      before && after ? `${before.name} ⇄ ${after.name} — deeddiff` : "deeddiff";
    void getCurrentWindow().setTitle(title);
  }, [before, after]);

  // Unload the model on exit so we leave no resident state.
  useEffect(() => {
    const handler = () => {
      if (model) void unloadModel(model);
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [model]);

  const runCompare = useCallback(async () => {
    if (!before || !after) return;
    noteHandle.current?.cancel();
    const epoch = ++runEpoch.current;
    const stale = () => epoch !== runEpoch.current;

    setWarning(null);
    setRedlineFile(null);
    setRedlineBytes(null);
    setComparison(null);
    setNotes({});
    changedPairs.current = [];

    try {
      setStage({ name: "ingesting", which: "before" });
      const a = await ingestVersion(before, readBytes);
      if (stale()) return;
      setStage({ name: "ingesting", which: "after" });
      const b = await ingestVersion(after, readBytes);
      if (stale()) return;

      if (a.fromOcr || b.fromOcr) {
        setWarning(
          "One version was scanned and read via OCR — the rendered redline is best-effort; the deterministic text comparison is authoritative."
        );
      }
      if (a.emptyText || b.emptyText) {
        setWarning("OCR found little or no text — is this a blank or image-only scan?");
      }

      setStage({ name: "comparing" });
      const { redline, revisions } = await compare(a.docx, b.docx);
      if (stale()) return;
      setRedlineBytes(redline);
      setRedlineFile(redlineToFile(redline));

      setStage({ name: "pairing" });
      const [origBlocks, modBlocks] = await Promise.all([
        projectBlocks(a.docx),
        projectBlocks(b.docx),
      ]);
      if (stale()) return;

      // The authoritative, AI-free determination of same vs. different.
      const result = compareBlocks(origBlocks, modBlocks, revisions);
      setComparison(result);

      const pairs = changedClausePairs(result);
      changedPairs.current = pairs;

      // AI notes are optional. Without them the result above is already complete.
      if (!aiEnabled || !model || pairs.length === 0) {
        setStage({ name: "ready" });
        if (aiEnabled && !model && pairs.length > 0) {
          setWarning("Select an Ollama model to add AI change notes (optional).");
        }
        return;
      }

      let completed = 0;
      setStage({ name: "generating", done: 0, total: pairs.length });
      setNotes(Object.fromEntries(pairs.map((p) => [p.id, { status: "pending" } as NoteState])));
      noteHandle.current = generateNotes(model, pairs, (index, state) => {
        if (stale()) return;
        const unid = pairs[index].id;
        setNotes((prev) => ({ ...prev, [unid]: state }));
        if (state.status === "done" || state.status === "error") {
          completed++;
          setStage(
            completed >= pairs.length
              ? { name: "ready" }
              : { name: "generating", done: completed, total: pairs.length }
          );
        }
      });
    } catch (err) {
      if (stale()) return;
      setStage({ name: "error", message: errorMessage(err) });
    }
  }, [before, after, model, aiEnabled]);

  const retryNote = useCallback(
    async (item: ComparedItem) => {
      if (!model) return;
      const pair = changedPairs.current.find((p) => p.id === item.unid);
      if (!pair) return;
      setNotes((prev) => ({ ...prev, [item.unid]: { status: "pending" } }));
      try {
        const note = await requestNote(model, pair);
        setNotes((prev) => ({ ...prev, [item.unid]: { status: "done", note } }));
      } catch (err) {
        setNotes((prev) => ({ ...prev, [item.unid]: { status: "error", message: errorMessage(err) } }));
      }
    },
    [model]
  );

  // Best-effort item↔clause linkage: scroll the rendered redline to the clause.
  const selectClause = useCallback((item: ComparedItem) => {
    const snippet = (item.after || item.before).trim().slice(0, 40);
    if (!snippet) return;
    const root = document.querySelector(".redline-pane");
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.textContent && node.textContent.includes(snippet)) {
        const el = node.parentElement;
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        el?.classList.add("clause-highlight");
        setTimeout(() => el?.classList.remove("clause-highlight"), 1600);
        return;
      }
    }
  }, []);

  const swap = () => {
    setBefore(after);
    setAfter(before);
  };

  const exportRedline = async () => {
    if (!redlineBytes) return;
    const path = await save({ filters: [{ name: "DOCX", extensions: ["docx"] }] });
    if (path) await saveBytes(path, redlineBytes);
  };

  const exportReport = async () => {
    if (!comparison) return;
    const path = await save({ filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (!path) return;
    const md = buildComparisonReport(comparison, {
      nameA: before?.name ?? "before",
      nameB: after?.name ?? "after",
      notes,
    });
    await saveBytes(path, TEXT_ENCODER.encode(md));
  };

  const busy =
    stage.name === "ingesting" ||
    stage.name === "comparing" ||
    stage.name === "pairing" ||
    stage.name === "generating";

  if (!simdOk) {
    return (
      <div className="simd-error">
        <h2>Unsupported WebView</h2>
        <p>
          deeddiff needs WebAssembly SIMD to render redlines. On Linux this requires
          WebKitGTK ≥ 2.40. Please update your system WebView and relaunch.
        </p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="toolbar">
        <h1>deeddiff</h1>
        <label className="ai-toggle" title="AI notes are an optional bonus; the comparison is always deterministic.">
          <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
          AI notes
        </label>
        {aiEnabled && <ModelSelector value={model} onChange={setModel} />}
        <div className="pickers">
          <VersionPicker label="Before" value={before} onChange={setBefore} />
          <button className="swap" title="Swap" onClick={swap} disabled={busy}>
            ⇄
          </button>
          <VersionPicker label="After" value={after} onChange={setAfter} />
        </div>
        <button className="primary" onClick={runCompare} disabled={!before || !after || busy}>
          {busy ? "Working…" : "Compare"}
        </button>
        <div className="exports">
          <button onClick={exportRedline} disabled={!redlineBytes}>
            Export redline
          </button>
          <button onClick={exportReport} disabled={!comparison}>
            Export report
          </button>
        </div>
      </header>

      <StageBar stage={stage} />
      {warning && <div className="warning-bar">{warning}</div>}

      <main className="panes">
        <section className="redline-pane">
          <ErrorBoundary fallbackLabel="The redline viewer failed to render">
            <RedlineViewer file={redlineFile} />
          </ErrorBoundary>
        </section>
        <aside className="notes-pane">
          {comparison && (stage.name === "ready" || stage.name === "generating") ? (
            <ComparisonPanel
              comparison={comparison}
              notes={aiEnabled ? notes : undefined}
              onSelect={selectClause}
              onRetry={retryNote}
            />
          ) : (
            <div className="notes-empty">
              Choose two versions and press <b>Compare</b>.
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

function StageBar({ stage }: { stage: Stage }) {
  let text = "";
  switch (stage.name) {
    case "ingesting":
      text = `Reading ${stage.which} version…`;
      break;
    case "comparing":
      text = "Generating redline…";
      break;
    case "pairing":
      text = "Comparing clauses…";
      break;
    case "generating":
      text = `Writing AI notes… ${stage.done}/${stage.total}`;
      break;
    case "error":
      return <div className="stage-bar error">{stage.message}</div>;
    default:
      return null;
  }
  return (
    <div className="stage-bar">
      <span className="spinner" /> {text}
    </div>
  );
}
