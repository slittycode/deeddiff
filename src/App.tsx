import { useCallback, useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { ClausePair, VersionInput } from "./lib/types";
import { compare, projectBlocks, redlineToFile } from "./lib/docxodus";
import { buildClausePairs } from "./lib/clausePairs";
import { ingestVersion } from "./lib/ingest";
import { readBytes, saveBytes } from "./lib/platform";
import { generateNotes, errorMessage, type GenerateHandle, type NoteState } from "./lib/notes";
import { requestNote, unloadModel } from "./lib/ollama";
import { buildNotesReport } from "./lib/report";
import { hasWasmSimd } from "./lib/wasmCheck";

import { VersionPicker } from "./components/VersionPicker";
import { ModelSelector } from "./components/ModelSelector";
import { RedlineViewer } from "./components/RedlineViewer";
import { ClauseNotesPanel } from "./components/ClauseNotesPanel";
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

  const [model, setModel] = useState<string | null>(null);
  const [before, setBefore] = useState<VersionInput | null>(null);
  const [after, setAfter] = useState<VersionInput | null>(null);

  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [redlineFile, setRedlineFile] = useState<File | null>(null);
  const [redlineBytes, setRedlineBytes] = useState<Uint8Array | null>(null);
  const [pairs, setPairs] = useState<ClausePair[]>([]);
  const [notes, setNotes] = useState<NoteState[]>([]);
  const [warning, setWarning] = useState<string | null>(null);

  const runEpoch = useRef(0);
  const noteHandle = useRef<GenerateHandle | null>(null);

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
    setPairs([]);
    setNotes([]);

    try {
      setStage({ name: "ingesting", which: "before" });
      const a = await ingestVersion(before, readBytes);
      if (stale()) return;
      setStage({ name: "ingesting", which: "after" });
      const b = await ingestVersion(after, readBytes);
      if (stale()) return;

      if (a.fromOcr || b.fromOcr) {
        setWarning(
          "One version was scanned and read via OCR — the rendered redline is best-effort; the change notes use normalized text and are authoritative."
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
      const clausePairs = buildClausePairs(origBlocks, modBlocks, revisions);
      setPairs(clausePairs);
      setNotes(clausePairs.map(() => ({ status: "pending" }) as NoteState));

      if (clausePairs.length === 0) {
        setStage({ name: "ready" });
        return;
      }

      if (!model) {
        setStage({ name: "ready" });
        setWarning("Select an Ollama model to generate change notes.");
        return;
      }

      let completed = 0;
      setStage({ name: "generating", done: 0, total: clausePairs.length });
      noteHandle.current = generateNotes(model, clausePairs, (index, state) => {
        if (stale()) return;
        setNotes((prev) => {
          const next = [...prev];
          next[index] = state;
          return next;
        });
        if (state.status === "done" || state.status === "error") {
          completed++;
          setStage(
            completed >= clausePairs.length
              ? { name: "ready" }
              : { name: "generating", done: completed, total: clausePairs.length }
          );
        }
      });
    } catch (err) {
      if (stale()) return;
      setStage({ name: "error", message: errorMessage(err) });
    }
  }, [before, after, model]);

  const retryNote = useCallback(
    async (index: number) => {
      if (!model) return;
      const pair = pairs[index];
      setNotes((prev) => {
        const next = [...prev];
        next[index] = { status: "pending" };
        return next;
      });
      try {
        const note = await requestNote(model, pair);
        setNotes((prev) => {
          const next = [...prev];
          next[index] = { status: "done", note };
          return next;
        });
      } catch (err) {
        setNotes((prev) => {
          const next = [...prev];
          next[index] = { status: "error", message: errorMessage(err) };
          return next;
        });
      }
    },
    [model, pairs]
  );

  // Best-effort note↔clause linkage: scroll the rendered redline to the clause.
  const selectClause = useCallback((pair: ClausePair) => {
    const snippet = (pair.after || pair.before).trim().slice(0, 40);
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
    if (pairs.length === 0) return;
    const path = await save({ filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (!path) return;
    const md = buildNotesReport(pairs, notes, {
      nameA: before?.name ?? "before",
      nameB: after?.name ?? "after",
      model: model ?? "(none)",
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
        <ModelSelector value={model} onChange={setModel} />
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
          <button onClick={exportReport} disabled={pairs.length === 0}>
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
          {stage.name === "ready" || stage.name === "generating" ? (
            <ClauseNotesPanel
              pairs={pairs}
              notes={notes}
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
      text = "Finding changed clauses…";
      break;
    case "generating":
      text = `Writing notes… ${stage.done}/${stage.total}`;
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
