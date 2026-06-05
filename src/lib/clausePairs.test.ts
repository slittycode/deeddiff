import { describe, it, expect } from "vitest";
import { buildClausePairs, normalizeForMatch } from "./clausePairs";
import type { MarkdownBlock, Revision } from "./types";

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

  it("pairs a modified clause (text change => new unid) by similarity", () => {
    const orig = [
      b("1", "Alpha"),
      b("2", "The Provider shall indemnify the Client up to a cap of $1,000,000."),
    ];
    const mod = [
      b("1", "Alpha"),
      b("2b", "The Provider shall indemnify the Client."),
    ];
    const pairs = buildClausePairs(orig, mod);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      kind: "modified",
      before: "The Provider shall indemnify the Client up to a cap of $1,000,000.",
      after: "The Provider shall indemnify the Client.",
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

  it("treats a dissimilar removal + addition as independent, not a modification", () => {
    const orig = [b("1", "one"), b("2", "two"), b("3", "three")];
    const mod = [b("1", "one"), b("9", "alpha"), b("8", "beta"), b("7", "gamma")];
    const pairs = buildClausePairs(orig, mod);
    // two, three share no words with alpha/beta/gamma → 2 removed + 3 added.
    const kinds = pairs.map((p) => p.kind).sort();
    expect(kinds).toEqual(["added", "added", "added", "removed", "removed"]);
  });

  it("emits a format-only pair from a FormatChanged revision", () => {
    const blocks = [b("1", "Heading")];
    const revs: Revision[] = [
      {
        author: "x",
        date: "",
        revisionType: "FormatChanged",
        text: "Heading",
        formatChange: { changedPropertyNames: ["bold", "fontSize"] },
      },
    ];
    const pairs = buildClausePairs(blocks, blocks, revs);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].kind).toBe("format");
    expect(pairs[0].detail).toContain("bold");
  });
});

describe("normalizeForMatch", () => {
  it("is case/whitespace/punctuation insensitive", () => {
    expect(normalizeForMatch("The  “Cap” —removed")).toBe(normalizeForMatch("the 'cap' -REMOVED"));
  });
});
