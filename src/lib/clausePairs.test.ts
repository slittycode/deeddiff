import { describe, it, expect } from "vitest";
import {
  buildClausePairs,
  collapseMoves,
  appendFormatChanges,
  normalizeForMatch,
} from "./clausePairs";
import type { ClausePair, MarkdownBlock, Revision } from "./types";

const b = (unid: string, text: string): MarkdownBlock => ({ unid, text });

describe("buildClausePairs", () => {
  it("returns no pairs for identical documents", () => {
    const blocks = [b("1", "Alpha"), b("2", "Beta")];
    expect(buildClausePairs(blocks, blocks)).toEqual([]);
  });

  it("detects an inserted clause", () => {
    const orig = [b("1", "Alpha"), b("2", "Gamma")];
    const mod = [b("1", "Alpha"), b("9", "Beta"), b("2", "Gamma")];
    const pairs = buildClausePairs(orig, mod);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ kind: "added", before: "", after: "Beta" });
  });

  it("detects a removed clause", () => {
    const orig = [b("1", "Alpha"), b("2", "Beta"), b("3", "Gamma")];
    const mod = [b("1", "Alpha"), b("3", "Gamma")];
    const pairs = buildClausePairs(orig, mod);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ kind: "removed", before: "Beta", after: "" });
  });

  it("pairs a modified clause (text change => new unid)", () => {
    const orig = [b("1", "Alpha"), b("2", "cap of $1,000,000")];
    const mod = [b("1", "Alpha"), b("2b", "cap removed")];
    const pairs = buildClausePairs(orig, mod);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      kind: "modified",
      before: "cap of $1,000,000",
      after: "cap removed",
    });
  });

  it("collapses a relocated clause into a single 'moved' pair", () => {
    const orig = [b("x", "Confidentiality survives"), b("a", "A"), b("c", "C")];
    const mod = [b("a", "A"), b("c", "C"), b("x", "Confidentiality survives")];
    const pairs = buildClausePairs(orig, mod);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].kind).toBe("moved");
    expect(pairs[0].before).toBe("Confidentiality survives");
  });

  it("handles N:M changed runs without losing clauses", () => {
    const orig = [b("1", "one"), b("2", "two"), b("3", "three")];
    const mod = [b("1", "one"), b("9", "alpha"), b("8", "beta"), b("7", "gamma")];
    const pairs = buildClausePairs(orig, mod);
    // 2,3 removed; alpha,beta,gamma added → 3 pairs total, none dropped.
    expect(pairs).toHaveLength(3);
    const kinds = pairs.map((p) => p.kind).sort();
    expect(kinds).toEqual(["added", "modified", "modified"]);
  });
});

describe("appendFormatChanges", () => {
  it("adds format-only notes invisible to the text diff", () => {
    const revs: Revision[] = [
      {
        author: "x",
        date: "",
        revisionType: "FormatChanged",
        text: "Heading",
        formatChange: { changedPropertyNames: ["bold", "fontSize"] },
      },
    ];
    const out = appendFormatChanges([], revs);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("format");
    expect(out[0].detail).toContain("bold");
  });
});

describe("collapseMoves", () => {
  it("ignores empty removed text", () => {
    const pairs: ClausePair[] = [{ id: "1", kind: "removed", before: "", after: "" }];
    expect(collapseMoves(pairs)).toEqual(pairs);
  });
});

describe("normalizeForMatch", () => {
  it("is case/whitespace/punctuation insensitive", () => {
    expect(normalizeForMatch("The  “Cap” —removed")).toBe(normalizeForMatch("the 'cap' -REMOVED"));
  });
});
