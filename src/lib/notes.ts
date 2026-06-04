import type { ClauseNote, ClausePair } from "./types";
import { cacheKey, requestNote } from "./ollama";

/**
 * Per-clause note generation with: a deterministic in-memory cache (so re-running
 * a compare only re-hits the LLM for genuinely changed clauses), bounded
 * concurrency (Ollama serializes by default, so this just smooths pipelining),
 * and epoch-based cancellation (a new run discards late results from the old one).
 */

export type NoteState =
  | { status: "pending" }
  | { status: "done"; note: ClauseNote }
  | { status: "error"; message: string };

const cache = new Map<string, ClauseNote>();

export function getCached(model: string, pair: ClausePair): ClauseNote | undefined {
  return cache.get(cacheKey(model, pair));
}

/** Default concurrency. Ollama serializes on one model anyway; 2 smooths queueing. */
const DEFAULT_CONCURRENCY = 2;

export interface GenerateHandle {
  /** Cancel this run; subsequent results are ignored. */
  cancel: () => void;
}

/**
 * Generate notes for all pairs, invoking `onUpdate(index, state)` as each
 * resolves. Format-only clauses get a synthesized note without an LLM call.
 */
export function generateNotes(
  model: string,
  pairs: ClausePair[],
  onUpdate: (index: number, state: NoteState) => void,
  concurrency = DEFAULT_CONCURRENCY
): GenerateHandle {
  let cancelled = false;
  let next = 0;

  const runOne = async (index: number): Promise<void> => {
    const pair = pairs[index];

    // Format-only changes are deterministic; no model needed.
    if (pair.kind === "format") {
      onUpdate(index, {
        status: "done",
        note: {
          summary: pair.detail ?? "Formatting changed",
          whyItMatters: "Presentation only; no change to the clause's meaning.",
          category: "formatting",
          materiality: "none",
          direction: "modified",
        },
      });
      return;
    }

    const cached = getCached(model, pair);
    if (cached) {
      onUpdate(index, { status: "done", note: cached });
      return;
    }

    onUpdate(index, { status: "pending" });
    try {
      const note = await requestNote(model, pair);
      if (cancelled) return;
      cache.set(cacheKey(model, pair), note);
      onUpdate(index, { status: "done", note });
    } catch (err) {
      if (cancelled) return;
      onUpdate(index, { status: "error", message: errorMessage(err) });
    }
  };

  const worker = async (): Promise<void> => {
    while (!cancelled) {
      const index = next++;
      if (index >= pairs.length) return;
      await runOne(index);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, pairs.length) }, worker);
  void Promise.all(workers);

  return {
    cancel: () => {
      cancelled = true;
    },
  };
}

/** Turn the typed CommandError (or anything) into a UI string. */
export function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "kind" in err) {
    const e = err as { kind: string; message?: string };
    switch (e.kind) {
      case "ollama_unreachable":
        return "Ollama isn't running. Start it with `ollama serve`.";
      case "model_not_found":
        return `Model not found. Pull it with \`ollama pull ${e.message ?? ""}\`.`;
      default:
        return e.message ?? e.kind;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

/** Exposed for tests. */
export function _clearCache(): void {
  cache.clear();
}
