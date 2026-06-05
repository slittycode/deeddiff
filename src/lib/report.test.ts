import { describe, it, expect } from "vitest";
import { buildComparisonReport } from "./report";
import { compareBlocks } from "./documentDiff";
import type { MarkdownBlock } from "./types";

const b = (unid: string, text: string): MarkdownBlock => ({ unid, text });

describe("buildComparisonReport (deterministic, no AI)", () => {
  it("states identical when nothing changed", () => {
    const blocks = [b("1", "Alpha"), b("2", "Beta")];
    const md = buildComparisonReport(compareBlocks(blocks, blocks), {
      nameA: "a.docx",
      nameB: "b.docx",
    });
    expect(md).toContain("the documents are identical");
    expect(md).toContain("| Unchanged | 2 |");
    expect(md).not.toContain("## Changes");
  });

  it("lists each change with before/after and omits unchanged blocks", () => {
    const orig = [b("1", "Alpha"), b("2", "cap of $1,000,000")];
    const mod = [b("1", "Alpha"), b("2b", "cap removed")];
    const md = buildComparisonReport(compareBlocks(orig, mod), {
      nameA: "a.docx",
      nameB: "b.docx",
    });
    expect(md).toContain("1 change(s)");
    expect(md).toContain("### 1. Modified");
    expect(md).toContain("**Before:** cap of $1,000,000");
    expect(md).toContain("**After:** cap removed");
    // The unchanged "Alpha" block is not listed as a change.
    expect(md).not.toContain("Alpha\n");
  });

  it("folds in optional AI notes when provided but never requires them", () => {
    const orig = [b("1", "cap of $1,000,000")];
    const mod = [b("1b", "cap removed")];
    const comparison = compareBlocks(orig, mod);
    const unid = comparison.items.find((i) => i.status === "modified")!.unid;
    const md = buildComparisonReport(comparison, {
      nameA: "a",
      nameB: "b",
      notes: {
        [unid]: {
          status: "done",
          note: {
            summary: "Indemnity cap removed",
            whyItMatters: "Liability now uncapped",
            category: "liability",
            materiality: "high",
            direction: "modified",
          },
        },
      },
    });
    expect(md).toContain("**What changed:** Indemnity cap removed");
    expect(md).toContain("**Why it matters:** Liability now uncapped");
  });
});
