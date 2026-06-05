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
    const orig = [b("1", "Alpha"), b("2", "cap of $1,000,000"), b("3", "Gamma")];
    const mod = [b("1", "Alpha"), b("2b", "cap removed"), b("3", "Gamma"), b("4", "New clause")];
    const { items, summary } = compareBlocks(orig, mod);

    // Order is preserved: same, modified, same, added.
    expect(items.map((i) => i.status)).toEqual(["same", "modified", "same", "added"]);
    expect(summary).toMatchObject({ same: 2, modified: 1, added: 1, changed: 2, identical: false });

    const modified = items.find((i) => i.status === "modified")!;
    expect(modified.before).toBe("cap of $1,000,000");
    expect(modified.after).toBe("cap removed");
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
    // 1 stays; two→alpha, three→beta modified; gamma added.
    expect(summary).toMatchObject({ same: 1, modified: 2, added: 1 });
    // No block is lost: every changed item carries non-empty text on its side.
    expect(items.every((i) => i.before || i.after)).toBe(true);
  });
});

describe("wordSegments", () => {
  it("returns a single equal segment for identical text", () => {
    const seg = wordSegments("same text", "same text");
    expect(seg).toEqual([{ value: "same text", type: "equal" }]);
  });
});
