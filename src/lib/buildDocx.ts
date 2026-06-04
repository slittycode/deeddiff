import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";

/** Subset of the liteparse JSON we consume. */
export interface LiteTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
}
export interface LitePage {
  pageNum: number;
  width?: number;
  height?: number;
  text?: string;
  textItems?: LiteTextItem[];
}
export interface LiteParseResult {
  text?: string;
  pages?: LitePage[];
}

/** A reconstructed paragraph with a heading flag. */
export interface Para {
  text: string;
  heading: boolean;
}

const LINE_Y_TOLERANCE = 4; // px: items within this y-distance are the same line
const PARAGRAPH_GAP_FACTOR = 1.6; // a vertical gap > factor*medianLineHeight breaks a paragraph
const HEADING_FONT_FACTOR = 1.2; // font this much bigger than median => heading

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const NUMBERED_HEADING = /^(\d+(\.\d+)*[.)]?|article|section)\s+/i;

/**
 * Reconstruct paragraphs from positioned text items. We group items into lines
 * by `y`, break paragraphs on large vertical gaps, and flag headings by font
 * size or leading numbering — far better clause boundaries than splitting raw
 * text on newlines (which OCR rarely lays out cleanly).
 */
export function paragraphsFromItems(items: LiteTextItem[]): Para[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

  // Group into lines.
  interface Line {
    y: number;
    height: number;
    fontSize: number;
    text: string;
  }
  const lines: Line[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(it.y - last.y) <= LINE_Y_TOLERANCE) {
      last.text += (last.text ? " " : "") + it.text.trim();
      last.height = Math.max(last.height, it.height);
      last.fontSize = Math.max(last.fontSize, it.fontSize ?? 0);
    } else {
      lines.push({
        y: it.y,
        height: it.height,
        fontSize: it.fontSize ?? 0,
        text: it.text.trim(),
      });
    }
  }

  const medianHeight = median(lines.map((l) => l.height).filter((h) => h > 0)) || 12;
  const medianFont = median(lines.map((l) => l.fontSize).filter((f) => f > 0)) || 0;

  // Merge lines into paragraphs on vertical gaps.
  const paras: Para[] = [];
  let currentText = "";
  let currentFont = 0;
  let prevY = lines[0]?.y ?? 0;

  const pushCurrent = () => {
    const text = currentText.trim();
    if (!text) return;
    const bigFont = medianFont > 0 && currentFont >= medianFont * HEADING_FONT_FACTOR;
    const heading = bigFont || NUMBERED_HEADING.test(text);
    paras.push({ text, heading });
  };

  for (const line of lines) {
    const gap = line.y - prevY;
    if (currentText && gap > medianHeight * PARAGRAPH_GAP_FACTOR) {
      pushCurrent();
      currentText = "";
      currentFont = 0;
    }
    currentText += (currentText ? " " : "") + line.text;
    currentFont = Math.max(currentFont, line.fontSize);
    prevY = line.y;
  }
  pushCurrent();

  return paras;
}

/** Reconstruct paragraphs across all pages. */
export function paragraphsFromPages(pages: LitePage[]): Para[] {
  const paras: Para[] = [];
  for (const page of pages) {
    if (page.textItems && page.textItems.length) {
      paras.push(...paragraphsFromItems(page.textItems));
    } else if (page.text) {
      // Fallback: no geometry, split on blank lines.
      for (const chunk of page.text.split(/\n{2,}/)) {
        const text = chunk.replace(/\s+/g, " ").trim();
        if (text) paras.push({ text, heading: NUMBERED_HEADING.test(text) });
      }
    }
  }
  return paras;
}

/** Pack reconstructed paragraphs into a minimal DOCX. */
export async function buildDocxFromParagraphs(paras: Para[]): Promise<Uint8Array> {
  const children = (paras.length ? paras : [{ text: "", heading: false }]).map((p) =>
    new Paragraph(
      p.heading
        ? { text: p.text, heading: HeadingLevel.HEADING_2 }
        : { children: [new TextRun(p.text)] }
    )
  );
  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}

export async function buildDocxFromPages(pages: LitePage[]): Promise<Uint8Array> {
  return buildDocxFromParagraphs(paragraphsFromPages(pages));
}
