import { describe, it, expect } from "vitest";
import { compareBlocks, wordSegments } from "./documentDiff";
import type { MarkdownBlock, Revision } from "./types";

const b = (unid: string, text: string): MarkdownBlock => ({ unid, text });

describe("compareBlocks — full same/different classification (no AI)", () => {
  it("marks every block 'same' and reports identical for matching documents", () => {
    const blocks = [b("1", "Alpha"), b("2", "Beta"), b("3", "Gamma")];
    const { items, summary } = compareBlocks(blocks, blocks);

    expect(items).toHaveLength(3);
    expect(items.every((i) => i.status === "same")).toBe(true);
    expect(summary).toMatchObject({
      same: 3,
      changed: 0,
      identical: true,
      totalBefore: 3,
      totalAfter: 3,
    });
  });

  it("classifies added / removed / modified while keeping unchanged context", () => {
    const orig = [
      b("1", "Alpha"),
      b("2", "The Provider shall indemnify the Client up to a cap of $1,000,000."),
      b("3", "Gamma"),
    ];
    const mod = [
      b("1", "Alpha"),
      b("2b", "The Provider shall indemnify the Client."),
      b("3", "Gamma"),
      b("4", "An entirely new confidentiality clause."),
    ];
    const { items, summary } = compareBlocks(orig, mod);

    // Order is preserved: same, modified, same, added.
    expect(items.map((i) => i.status)).toEqual(["same", "modified", "same", "added"]);
    expect(summary).toMatchObject({ same: 2, modified: 1, added: 1, changed: 2, identical: false });

    const modified = items.find((i) => i.status === "modified")!;
    expect(modified.before).toContain("cap of $1,000,000");
    expect(modified.after).toBe("The Provider shall indemnify the Client.");
  });

  it("does NOT pair a dissimilar removal and addition as a modification", () => {
    // A removed clause and an added clause that share no words are independent,
    // even when they sit in the same changed region — they must not collapse
    // into a spurious 'modified'.
    const orig = [b("1", "Termination rights for either party on 30 days notice.")];
    const mod = [b("2", "Confidentiality obligations survive for three years.")];
    const { items, summary } = compareBlocks(orig, mod);
    expect(summary).toMatchObject({ modified: 0, removed: 1, added: 1 });
    expect(items.map((i) => i.status).sort()).toEqual(["added", "removed"]);
  });

  it("attaches word-level segments to a modified item", () => {
    const orig = [b("1", "settled within 10 working days")];
    const mod = [b("1b", "settled within 5 working days")];
    const { items } = compareBlocks(orig, mod);

    const seg = items[0].segments!;
    // The unchanged words are equal; only the numeral differs.
    expect(seg.some((s) => s.type === "delete" && s.value.includes("10"))).toBe(true);
    expect(seg.some((s) => s.type === "insert" && s.value.includes("5"))).toBe(true);
    expect(seg.some((s) => s.type === "equal" && s.value.includes("working days"))).toBe(true);
    // Reassembling equal+delete reproduces the "before"; equal+insert the "after".
    const before = seg.filter((s) => s.type !== "insert").map((s) => s.value).join("");
    const after = seg.filter((s) => s.type !== "delete").map((s) => s.value).join("");
    expect(before).toBe("settled within 10 working days");
    expect(after).toBe("settled within 5 working days");
  });

  it("collapses a relocated clause into a single 'moved' item", () => {
    const orig = [b("x", "Confidentiality survives"), b("a", "A"), b("c", "C")];
    const mod = [b("a", "A"), b("c", "C"), b("x", "Confidentiality survives")];
    const { items, summary } = compareBlocks(orig, mod);

    expect(summary).toMatchObject({ moved: 1, removed: 0, added: 0 });
    const moved = items.find((i) => i.status === "moved")!;
    expect(moved.before).toBe("Confidentiality survives");
    expect(moved.detail).toMatch(/moved/i);
    // The two unchanged clauses remain present and 'same'.
    expect(items.filter((i) => i.status === "same")).toHaveLength(2);
  });

  it("appends format-only changes from revisions", () => {
    const blocks = [b("1", "Heading"), b("2", "Body")];
    const revs: Revision[] = [
      {
        author: "x",
        date: "",
        revisionType: "FormatChanged",
        text: "Heading",
        formatChange: { changedPropertyNames: ["bold"] },
      },
    ];
    const { items, summary } = compareBlocks(blocks, blocks, revs);
    expect(summary).toMatchObject({ same: 2, format: 1, changed: 1, identical: false });
    expect(items.at(-1)).toMatchObject({ status: "format", detail: expect.stringContaining("bold") });
  });

  it("handles N:M changed runs without dropping blocks", () => {
    const orig = [b("1", "one"), b("2", "two"), b("3", "three")];
    const mod = [b("1", "one"), b("9", "alpha"), b("8", "beta"), b("7", "gamma")];
    const { items, summary } = compareBlocks(orig, mod);
    // 1 stays; two/three share no words with alpha/beta/gamma → 2 removed, 3 added.
    expect(summary).toMatchObject({ same: 1, modified: 0, removed: 2, added: 3 });
    // No block is lost: every changed item carries non-empty text on its side.
    expect(items.every((i) => i.before || i.after)).toBe(true);
  });

  it("matches the most similar counterpart within a mixed changed run", () => {
    const orig = [
      b("1", "Payment is due within 30 days of invoice."),
      b("2", "The agreement may be terminated for cause."),
    ];
    const mod = [
      // Reordered + each lightly edited: similarity must pair them correctly,
      // not positionally.
      b("3", "The agreement may be terminated for cause or convenience."),
      b("4", "Payment is due within 14 days of invoice."),
    ];
    const { items } = compareBlocks(orig, mod);
    const payment = items.find((i) => i.after.includes("Payment"))!;
    const termination = items.find((i) => i.after.includes("terminated"))!;
    expect(payment.status).toBe("modified");
    expect(payment.before).toContain("30 days");
    expect(termination.status).toBe("modified");
    expect(termination.before).toContain("terminated for cause.");
  });
});

describe("wordSegments", () => {
  it("returns a single equal segment for identical text", () => {
    const seg = wordSegments("same text", "same text");
    expect(seg).toEqual([{ value: "same text", type: "equal" }]);
  });
});
