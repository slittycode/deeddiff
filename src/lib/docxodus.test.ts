import { describe, it, expect } from "vitest";
import { parseMarkdownBlocks } from "./docxodus";

// Pure coverage for the markdown→blocks parser (no WASM). The full real-engine
// path is covered in docxodus.integration.test.ts.

describe("parseMarkdownBlocks", () => {
  const md = [
    "# Document",
    "",
    "{#h:body:AAA} ## MASTER SERVICES AGREEMENT",
    "",
    "{#p:body:BBB} 1. Indemnification. The Provider shall indemnify the Client up to a cap of $1,000,000.",
    "",
    "{#p:body:CCC} 2. Settlement. Invoices are settled within 10 working days.",
    "",
  ].join("\n");

  const index = {
    "h:body:AAA": { unid: "unid-aaa" },
    "p:body:BBB": { unid: "unid-bbb" },
    "p:body:CCC": { unid: "unid-ccc" },
  };

  it("maps anchor ids to content unids in document order", () => {
    const blocks = parseMarkdownBlocks(md, index);
    expect(blocks.map((b) => b.unid)).toEqual(["unid-aaa", "unid-bbb", "unid-ccc"]);
  });

  it("keeps the FULL clause text, not a truncated preview", () => {
    const blocks = parseMarkdownBlocks(md, index);
    // The cap figure sits ~75 chars in — the old 80-char preview would clip it.
    expect(blocks[1].text).toContain("$1,000,000.");
  });

  it("strips markdown heading markers from the text", () => {
    const blocks = parseMarkdownBlocks(md, index);
    expect(blocks[0].text).toBe("MASTER SERVICES AGREEMENT");
  });

  it("accumulates a block that spans multiple lines", () => {
    const multi = "{#p:body:X} First line of the clause\ncontinues here.\n\n{#p:body:Y} Next.";
    const blocks = parseMarkdownBlocks(multi, { "p:body:X": { unid: "x" }, "p:body:Y": { unid: "y" } });
    expect(blocks[0].text).toBe("First line of the clause continues here.");
    expect(blocks).toHaveLength(2);
  });

  it("falls back to the anchor id when no unid is known, and skips empty blocks", () => {
    const blocks = parseMarkdownBlocks("{#p:body:Z} Only text\n\n{#sec:body:W} ", {});
    expect(blocks).toEqual([{ unid: "p:body:Z", text: "Only text" }]);
  });

  it("returns nothing for markdown without anchors", () => {
    expect(parseMarkdownBlocks("# Document\n\nplain paragraph")).toEqual([]);
  });
});
