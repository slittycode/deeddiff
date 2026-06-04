// End-to-end integration of the renderer's clause-notes pipeline, exercised
// across module boundaries with the Tauri `invoke` call mocked at the IPC seam
// (i.e. standing in for the Rust `ollama_chat`/`ollama_list_models` commands).
//
// This is the automated counterpart to the manual "notes pipeline" checklist:
// it spans real `buildClausePairs` output → `generateNotes` (concurrency, cache,
// cancellation, error mapping) → `ollama.ts` payload assembly + `parseNote`,
// using only the LLM daemon as a stub. The docxodus WASM compare that produces
// the markdown blocks upstream is the one piece still covered manually (it needs
// the .NET-WASM runtime); here we feed representative blocks directly.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { buildClausePairs } from "./clausePairs";
import { generateNotes, _clearCache, type NoteState } from "./notes";
import { listModels } from "./ollama";
import type { ClausePair, MarkdownBlock, Revision } from "./types";

const mockInvoke = vi.mocked(invoke);

// A realistic mixed change set: one modified clause (indemnity cap), one removed
// clause (termination), one added clause (confidentiality), framed by unchanged
// clauses that share a unid across both versions, plus a format-only revision.
const UNCHANGED_INTRO = "Definitions. In this Agreement the following terms apply.";
const UNCHANGED_LAW = "This Agreement is governed by the laws of England and Wales.";
const ADDED_TEXT = "Confidentiality obligations survive termination for three years.";

const orig: MarkdownBlock[] = [
  { unid: "u1", text: UNCHANGED_INTRO },
  { unid: "u2", text: "The Provider shall indemnify the Client up to a cap of $1,000,000." },
  { unid: "u3", text: "Either party may terminate this Agreement on 30 days written notice." },
  { unid: "u5", text: UNCHANGED_LAW },
];

const mod: MarkdownBlock[] = [
  { unid: "u1", text: UNCHANGED_INTRO },
  { unid: "u2b", text: "The Provider shall indemnify the Client." },
  { unid: "u5", text: UNCHANGED_LAW },
  { unid: "u6", text: ADDED_TEXT },
];

const revisions: Revision[] = [
  {
    author: "deeddiff",
    date: "2026-01-01T00:00:00Z",
    revisionType: "FormatChanged",
    text: "Section 9 heading",
    formatChange: { changedPropertyNames: ["bold", "underline"] },
  },
];

/** A structured note as Ollama would return it: a JSON *string* in message.content. */
function noteJson(summary: string): string {
  return JSON.stringify({
    summary,
    whyItMatters: "Shifts risk allocation between the parties.",
    category: "liability",
    materiality: "high",
    direction: "modified",
  });
}

/** Run generateNotes to completion, resolving with the final per-index states. */
function runAll(model: string, pairs: ClausePair[], concurrency?: number): Promise<NoteState[]> {
  return new Promise((resolve) => {
    const states: NoteState[] = new Array(pairs.length);
    let terminal = 0;
    generateNotes(
      model,
      pairs,
      (i, s) => {
        states[i] = s;
        if (s.status === "done" || s.status === "error") {
          terminal++;
          if (terminal === pairs.length) resolve(states);
        }
      },
      concurrency
    );
  });
}

beforeEach(() => {
  _clearCache();
  mockInvoke.mockReset();
});

describe("clause-notes pipeline (blocks → pairs → notes)", () => {
  it("produces the expected change set from the two projections", () => {
    const pairs = buildClausePairs(orig, mod, revisions);
    const byKind = pairs.map((p) => p.kind);
    // Positional N:M pairing: modified (u2→u2b) + removed (u3); then added (u6);
    // then the format-only revision.
    expect(byKind).toEqual(["modified", "removed", "added", "format"]);
    expect(pairs.find((p) => p.kind === "added")?.after).toBe(ADDED_TEXT);
    expect(pairs.find((p) => p.kind === "format")?.detail).toContain("bold");
  });

  it("generates a note per changed clause, synthesizing format notes without the LLM", async () => {
    const chatBodies: string[] = [];
    mockInvoke.mockImplementation(async (cmd, args) => {
      if (cmd !== "ollama_chat") throw new Error(`unexpected command ${cmd}`);
      const user = (args as { args: { user: string } }).args.user;
      chatBodies.push(user);
      const summary = user.includes("indemnify")
        ? "Indemnity cap removed"
        : user.includes("terminate")
          ? "Termination right removed"
          : "Confidentiality clause added";
      return noteJson(summary);
    });

    const pairs = buildClausePairs(orig, mod, revisions);
    const states = await runAll("llama3.1:8b", pairs);

    // Every clause resolved.
    expect(states.every((s) => s.status === "done")).toBe(true);

    // The LLM was called once per non-format clause (3), never for the format one.
    expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(chatBodies).toHaveLength(3);

    // Format-only note is synthesized locally and marked immaterial.
    const formatIdx = pairs.findIndex((p) => p.kind === "format");
    const formatState = states[formatIdx];
    expect(formatState.status).toBe("done");
    if (formatState.status === "done") {
      expect(formatState.note.category).toBe("formatting");
      expect(formatState.note.materiality).toBe("none");
      expect(formatState.note.summary).toContain("bold");
    }

    // The modified-clause note round-tripped through parseNote.
    const modIdx = pairs.findIndex((p) => p.kind === "modified");
    const modState = states[modIdx];
    if (modState.status === "done") {
      expect(modState.note.summary).toBe("Indemnity cap removed");
    }
  });

  it("never leaks other clauses' or unchanged text into a clause's payload", async () => {
    const chatBodies: string[] = [];
    mockInvoke.mockImplementation(async (_cmd, args) => {
      chatBodies.push((args as { args: { user: string } }).args.user);
      return noteJson("ok");
    });

    const pairs = buildClausePairs(orig, mod, revisions);
    await runAll("m", pairs);

    // The indemnity payload must contain only its own before/after — not the
    // added confidentiality clause, the unrelated termination clause, or the
    // unchanged framing text.
    const indemnity = chatBodies.find((b) => b.includes("indemnify"))!;
    expect(indemnity).toBeDefined();
    expect(indemnity).toContain("cap of $1,000,000");
    expect(indemnity).not.toContain(ADDED_TEXT);
    expect(indemnity).not.toContain(UNCHANGED_INTRO);
    expect(indemnity).not.toContain(UNCHANGED_LAW);
    expect(indemnity).not.toContain("30 days written notice");
  });

  it("caches deterministic notes so a re-run hits the LLM zero extra times", async () => {
    mockInvoke.mockImplementation(async () => noteJson("Indemnity cap removed"));
    const pairs = buildClausePairs(orig, mod, revisions);

    await runAll("llama3.1:8b", pairs);
    expect(mockInvoke).toHaveBeenCalledTimes(3);

    // Second run of the identical compare: every non-format clause is cached.
    await runAll("llama3.1:8b", pairs);
    expect(mockInvoke).toHaveBeenCalledTimes(3); // unchanged

    // A different model is a different cache key → re-queries.
    await runAll("qwen2.5:7b", pairs);
    expect(mockInvoke).toHaveBeenCalledTimes(6);
  });

  it("surfaces a friendly message when Ollama is unreachable", async () => {
    mockInvoke.mockRejectedValue({ kind: "ollama_unreachable" });
    const pairs = buildClausePairs(orig, mod, revisions);
    const states = await runAll("llama3.1:8b", pairs);

    const errors = states.filter((s) => s.status === "error");
    // The three LLM clauses error; the format clause still resolves locally.
    expect(errors).toHaveLength(3);
    for (const e of errors) {
      if (e.status === "error") expect(e.message).toMatch(/ollama serve/i);
    }
  });

  it("cancellation discards in-flight results (no late 'done' states)", async () => {
    // Hold every chat call open until we explicitly release it.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    mockInvoke.mockImplementation(async () => {
      await gate;
      return noteJson("late");
    });

    const pairs = buildClausePairs(orig, mod, revisions).filter((p) => p.kind !== "format");
    const seen: NoteState[] = new Array(pairs.length);
    const handle = generateNotes("m", pairs, (i, s) => {
      seen[i] = s;
    });

    // Let the workers reach their awaited invoke, then cancel before any resolve.
    await Promise.resolve();
    handle.cancel();
    release();
    await new Promise((r) => setTimeout(r, 5));

    // Pending may have been delivered, but no clause should have completed.
    expect(seen.some((s) => s?.status === "done")).toBe(false);
  });
});

describe("model listing boundary", () => {
  it("returns the daemon's model list through the invoke seam", async () => {
    mockInvoke.mockResolvedValue([
      { name: "llama3.1:8b", param_size: "8.0B", size_bytes: 4920000000 },
    ]);
    const models = await listModels();
    expect(mockInvoke).toHaveBeenCalledWith("ollama_list_models");
    expect(models[0].name).toBe("llama3.1:8b");
  });
});
