import { describe, it, expect } from "vitest";
import {
  paragraphsFromItems,
  buildDocxFromParagraphs,
  type LiteTextItem,
} from "./buildDocx";

const item = (text: string, y: number, fontSize = 11): LiteTextItem => ({
  text,
  x: 72,
  y,
  width: 400,
  height: 12,
  fontSize,
});

describe("paragraphsFromItems", () => {
  it("groups lines into paragraphs on vertical gaps", () => {
    const items = [
      item("First clause line one.", 100),
      item("still first clause.", 113),
      item("Second clause far below.", 200), // big gap => new paragraph
    ];
    const paras = paragraphsFromItems(items);
    expect(paras).toHaveLength(2);
    expect(paras[0].text).toContain("First clause line one. still first clause.");
    expect(paras[1].text).toContain("Second clause far below.");
  });

  it("flags numbered and large-font lines as headings", () => {
    const paras = paragraphsFromItems([
      item("SCHEDULE A", 100, 18),
      item("1. Indemnification terms apply here.", 140, 11),
    ]);
    expect(paras[0].heading).toBe(true); // large font
    expect(paras[1].heading).toBe(true); // leading number
  });

  it("returns nothing for empty input", () => {
    expect(paragraphsFromItems([])).toEqual([]);
  });
});

describe("buildDocxFromParagraphs", () => {
  it("produces a valid DOCX (ZIP/OOXML PK signature)", async () => {
    const bytes = await buildDocxFromParagraphs([
      { text: "Hello clause", heading: false },
      { text: "1. Heading", heading: true },
    ]);
    expect(bytes.length).toBeGreaterThan(0);
    // ZIP local file header magic: PK\x03\x04
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("handles empty paragraph lists without throwing", async () => {
    const bytes = await buildDocxFromParagraphs([]);
    expect(bytes[0]).toBe(0x50);
  });
});
