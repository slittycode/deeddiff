import { describe, it, expect, vi } from "vitest";

// ingest.ts imports @tauri-apps/api/core (invoke) and buildDocx; mock the Tauri
// bridge so the pure helpers can be tested without the runtime.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { routeFile, isLikelyScan, normalizeOcrText } from "./ingest";
import type { LiteParseResult } from "./buildDocx";

describe("routeFile", () => {
  it("classifies by extension, case-insensitively", () => {
    expect(routeFile("Agreement.DOCX")).toBe("docx");
    expect(routeFile("scan.pdf")).toBe("pdf");
    expect(routeFile("notes.txt")).toBe("reject");
    expect(routeFile("old.doc")).toBe("reject");
  });
});

describe("isLikelyScan", () => {
  it("flags sparse-text PDFs as scans", () => {
    const scan: LiteParseResult = { text: "  ", pages: [{ pageNum: 1 }] };
    expect(isLikelyScan(scan)).toBe(true);
  });

  it("treats dense embedded text as a native PDF", () => {
    const dense: LiteParseResult = {
      text: "x".repeat(500),
      pages: [{ pageNum: 1 }],
    };
    expect(isLikelyScan(dense)).toBe(false);
  });

  it("treats a zero-page result as a scan", () => {
    expect(isLikelyScan({ text: "", pages: [] })).toBe(true);
  });
});

describe("normalizeOcrText", () => {
  it("normalizes quotes, soft hyphens and whitespace", () => {
    const messy = "The “Cap” is­ removed.\r\n\r\n\r\nNext   clause";
    const clean = normalizeOcrText(messy);
    expect(clean).toContain('"Cap"');
    expect(clean).not.toContain("­");
    expect(clean).not.toMatch(/\n{3,}/);
    expect(clean).toContain("Next clause");
  });
});
