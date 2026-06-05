// @vitest-environment node
//
// End-to-end test of the headless, AI-free comparison CLI (`scripts/compare.ts`):
// spawns it as a real subprocess against the committed DOCX fixtures and checks
// its output and exit code. This proves the whole pipeline (docxodus WASM →
// compareBlocks → report) runs with no GUI and no model.

import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";

const ROOT = process.cwd();
const A = resolve(ROOT, "tests/fixtures/contract-A.docx");
const B = resolve(ROOT, "tests/fixtures/contract-B.docx");

function runCli(args: string[]) {
  return spawnSync("npx", ["tsx", "scripts/compare.ts", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
}

describe("compare CLI (headless, no AI)", () => {
  it("reports the known changes and exits 1 when documents differ", () => {
    const r = runCli([A, B, "--quiet"]);
    expect(r.status).toBe(1);
    // +1 added, −1 removed, ~2 modified, 2 unchanged (no MONO_WASM noise).
    expect(r.stdout).toContain("4 change(s): +1 −1 ~2");
    expect(r.stdout).not.toContain("MONO_WASM");
  }, 120_000);

  it("exits 0 and reports identical when comparing a file with itself", () => {
    const r = runCli([A, A, "--quiet"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("identical");
  }, 120_000);

  it("emits clean, parseable JSON with --json", () => {
    const r = runCli([A, B, "--json"]);
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.summary).toMatchObject({ added: 1, removed: 1, modified: 2, identical: false });
    expect(Array.isArray(parsed.items)).toBe(true);
  }, 120_000);

  it("rejects non-DOCX input with exit code 2", () => {
    const r = runCli([A, "notes.pdf"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("not a .docx");
  }, 30_000);
});
