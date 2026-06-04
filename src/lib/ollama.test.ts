import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  buildChatArgs,
  buildUserMessage,
  parseNote,
  cacheKey,
  NOTE_SCHEMA,
  SYSTEM_PROMPT,
} from "./ollama";
import type { ClausePair } from "./types";

const pair: ClausePair = {
  id: "c1",
  kind: "modified",
  before: "indemnity cap of $1,000,000",
  after: "indemnity cap removed",
};

describe("buildChatArgs (clause-pair-only enforcement)", () => {
  it("sends only the clause pair and attaches the schema", () => {
    const args = buildChatArgs("llama3.1:8b", pair);
    expect(args.model).toBe("llama3.1:8b");
    expect(args.system).toBe(SYSTEM_PROMPT);
    expect(args.schema).toBe(NOTE_SCHEMA);
    // The user payload contains BOTH clause sides...
    expect(args.user).toContain("indemnity cap of $1,000,000");
    expect(args.user).toContain("indemnity cap removed");
  });

  it("does not leak unrelated/full-document text", () => {
    const secret = "CONFIDENTIAL SECTION 47 — unrelated boilerplate";
    const args = buildChatArgs("m", pair);
    expect(args.user).not.toContain(secret);
  });

  it("marks an absent side explicitly", () => {
    const added: ClausePair = { id: "x", kind: "added", before: "", after: "New clause" };
    const msg = buildUserMessage(added);
    expect(msg).toContain("(not present in this version)");
    expect(msg).toContain("New clause");
  });
});

describe("parseNote", () => {
  it("parses a well-formed structured note", () => {
    const note = parseNote(
      JSON.stringify({
        summary: "Indemnity cap removed",
        whyItMatters: "Uncapped liability",
        category: "liability",
        materiality: "high",
        direction: "modified",
      })
    );
    expect(note.materiality).toBe("high");
    expect(note.category).toBe("liability");
  });

  it("fills sane defaults for missing optional fields", () => {
    const note = parseNote(JSON.stringify({ summary: "x" }));
    expect(note.category).toBe("other");
    expect(note.materiality).toBe("low");
  });

  it("throws when summary is missing", () => {
    expect(() => parseNote(JSON.stringify({ category: "ip" }))).toThrow();
  });
});

describe("cacheKey", () => {
  it("is stable for the same model + clause text", () => {
    expect(cacheKey("m", pair)).toBe(cacheKey("m", { ...pair, id: "different-id" }));
  });
  it("differs by model", () => {
    expect(cacheKey("m1", pair)).not.toBe(cacheKey("m2", pair));
  });
});
