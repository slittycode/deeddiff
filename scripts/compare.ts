/**
 * Headless, AI-free document comparison.
 *
 *   npm run compare -- <before.docx> <after.docx> [--json] [--quiet]
 *
 * Loads the docxodus WASM engine under Node, runs the deterministic
 * same/different classification (the same `compareBlocks` the app uses), and
 * prints a Markdown report (or JSON with `--json`). No model, no network.
 *
 * Exit code: 0 if the documents are identical, 1 if they differ, 2 on error —
 * so it composes in scripts like a diff tool.
 *
 * Only DOCX is supported here; scanned-PDF ingestion needs the `lit` sidecar and
 * is available through the desktop app.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { initialize } from "docxodus";
import { compare, projectBlocks } from "../src/lib/docxodus";
import { compareBlocks } from "../src/lib/documentDiff";
import { buildComparisonReport } from "../src/lib/report";

const WASM_DIR = resolve(process.cwd(), "node_modules/docxodus/dist/wasm/") + "/";

function parseArgs(argv: string[]) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const positional = argv.filter((a) => !a.startsWith("--"));
  return { positional, json: flags.has("--json"), quiet: flags.has("--quiet") };
}

/**
 * Initialize the engine while suppressing the .NET runtime's `MONO_WASM:` chatter
 * on stdout, so `--json`/`--quiet` output stays clean and pipeable. Anything
 * non-MONO is passed through; stdout is restored afterwards.
 */
async function initQuietly(): Promise<void> {
  const realWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    const s = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    if (s.includes("MONO_WASM")) return true;
    return (realWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    await initialize(WASM_DIR);
  } finally {
    process.stdout.write = realWrite;
  }
}

async function main() {
  const { positional, json, quiet } = parseArgs(process.argv.slice(2));
  if (positional.length !== 2) {
    process.stderr.write(
      "usage: npm run compare -- <before.docx> <after.docx> [--json] [--quiet]\n"
    );
    process.exit(2);
  }
  const [pathA, pathB] = positional;

  for (const p of [pathA, pathB]) {
    if (!p.toLowerCase().endsWith(".docx")) {
      process.stderr.write(
        `error: ${p} is not a .docx. The CLI compares DOCX files; for scanned PDFs use the desktop app (OCR sidecar).\n`
      );
      process.exit(2);
    }
  }

  await initQuietly();

  const a = new Uint8Array(await readFile(resolve(pathA)));
  const b = new Uint8Array(await readFile(resolve(pathB)));

  const { revisions } = await compare(a, b);
  const [blocksA, blocksB] = await Promise.all([projectBlocks(a), projectBlocks(b)]);
  const comparison = compareBlocks(blocksA, blocksB, revisions);

  if (json) {
    process.stdout.write(JSON.stringify(comparison, null, 2) + "\n");
  } else if (quiet) {
    const s = comparison.summary;
    process.stdout.write(
      s.identical
        ? "identical\n"
        : `${s.changed} change(s): +${s.added} −${s.removed} ~${s.modified} ⇄${s.moved} ¶${s.format} (${s.same} unchanged)\n`
    );
  } else {
    process.stdout.write(
      buildComparisonReport(comparison, { nameA: pathA, nameB: pathB }) + "\n"
    );
  }

  process.exit(comparison.summary.identical ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`error: ${err?.message ?? err}\n`);
  process.exit(2);
});
