// @vitest-environment node
//
// Real-engine integration test for the docxodus boundary. Unlike the rest of the
// suite (jsdom + mocks), this loads the actual .NET-WASM comparison engine and
// runs it against the committed DOCX fixtures, then drives our own projection +
// clause-pairing on the real output. It is the automated counterpart to the
// manual "DOCX↔DOCX redline" checklist.
//
// Notes:
//   * Forced to the `node` environment: the engine loads its WASM from a
//     filesystem path here (the browser/jsdom path needs a fetch-served URL,
//     which is exercised by the running app, not this test).
//   * If the host cannot instantiate the WASM at all (no SIMD, etc.) the tests
//     skip with a clear message rather than failing the build.

import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { initialize, isInitialized } from "docxodus";
import { compare, projectBlocks, redlineToFile } from "./docxodus";
import { buildClausePairs } from "./clausePairs";
import { compareBlocks } from "./documentDiff";

const WASM_DIR = resolve(process.cwd(), "node_modules/docxodus/dist/wasm/") + "/";
const A = new Uint8Array(readFileSync(resolve(process.cwd(), "tests/fixtures/contract-A.docx")));
const B = new Uint8Array(readFileSync(resolve(process.cwd(), "tests/fixtures/contract-B.docx")));

let wasmReady = false;

beforeAll(async () => {
  try {
    await initialize(WASM_DIR);
    wasmReady = isInitialized();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[docxodus.integration] skipping — WASM engine unavailable in this host: ${
        (e as Error)?.message ?? e
      }`
    );
    wasmReady = false;
  }
}, 120_000);

describe("docxodus real-engine compare → project → pair", () => {
  it("compares two DOCX versions into a valid redline with revisions", async () => {
    if (!wasmReady) return; // skipped: see beforeAll warning
    const { redline, revisions } = await compare(A, B);

    // Redline is a real .docx (ZIP/OOXML → PK signature).
    expect(redline.byteLength).toBeGreaterThan(0);
    expect(redline[0]).toBe(0x50); // P
    expect(redline[1]).toBe(0x4b); // K

    // The fixtures differ (cap removed, 10→5, clause removed, clause added),
    // so the engine must report tracked changes.
    expect(revisions.length).toBeGreaterThan(0);

    // The redline wraps into a File for the viewer without throwing.
    const file = redlineToFile(redline);
    expect(file.size).toBe(redline.byteLength);
  }, 120_000);

  it("derives the known changed clauses, aligning unchanged ones out", async () => {
    if (!wasmReady) return; // skipped: see beforeAll warning
    const { revisions } = await compare(A, B);
    const blocksA = await projectBlocks(A);
    const blocksB = await projectBlocks(B);

    expect(blocksA.length).toBeGreaterThan(0);
    expect(blocksB.length).toBeGreaterThan(0);

    const pairs = buildClausePairs(blocksA, blocksB, revisions);
    expect(pairs.length).toBeGreaterThan(0);

    const allText = pairs.map((p) => `${p.before} || ${p.after}`).join("\n");

    // The known material changes surface as clause pairs.
    expect(allText).toContain("$1,000,000"); // indemnity cap (before side)
    expect(allText).toMatch(/5 working days/); // settlement 10 → 5
    expect(allText).toContain("Confidentiality"); // added clause

    // The genuinely unchanged clause (shared unid) must NOT appear as a change —
    // this is the property that makes unid-keyed alignment worthwhile.
    expect(allText).not.toContain("governed by the laws of England");
  }, 120_000);

  it("produces a complete deterministic same/different classification (no AI)", async () => {
    if (!wasmReady) return; // skipped: see beforeAll warning
    const { revisions } = await compare(A, B);
    const blocksA = await projectBlocks(A);
    const blocksB = await projectBlocks(B);

    const { items, summary } = compareBlocks(blocksA, blocksB, revisions);

    // The fixtures differ, so they are not identical, yet some blocks are 'same'.
    expect(summary.identical).toBe(false);
    expect(summary.same).toBeGreaterThan(0);
    expect(summary.changed).toBeGreaterThan(0);
    // Item count accounts for the whole "after" document plus removed-only blocks.
    expect(items.length).toBeGreaterThanOrEqual(summary.totalAfter);

    // The unchanged governing-law clause is classified 'same'…
    const law = items.find((i) => i.before.includes("governed by the laws of England"));
    expect(law?.status).toBe("same");

    // …and the settlement change carries a word-level segment delta (10 → 5).
    const settlement = items.find(
      (i) => i.status === "modified" && i.before.includes("working days")
    );
    expect(settlement?.segments?.some((s) => s.type === "delete" && s.value.includes("10"))).toBe(
      true
    );

    // The removed termination clause and the added confidentiality clause are
    // independent — similarity matching must NOT collapse them into one bogus
    // 'modified' item (the previous positional pairing did exactly that).
    const termination = items.find((i) => i.before.includes("Termination"));
    expect(termination?.status).toBe("removed");
    const confidentiality = items.find((i) => i.after.includes("Confidentiality"));
    expect(confidentiality?.status).toBe("added");
  }, 120_000);

  it("reports two identical documents as identical", async () => {
    if (!wasmReady) return; // skipped: see beforeAll warning
    const blocksA = await projectBlocks(A);
    const { summary } = compareBlocks(blocksA, blocksA, []);
    expect(summary.identical).toBe(true);
    expect(summary.changed).toBe(0);
    expect(summary.same).toBe(blocksA.length);
  }, 120_000);
});
