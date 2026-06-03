/**
 * Generate two DOCX versions of a toy agreement with a known set of changes:
 *   - a modified clause (indemnity cap removed),
 *   - a numeric change (10 -> 5 working days),
 *   - an added clause,
 *   - a removed clause.
 *
 * Run: `npm run make-fixtures`. Commit the output so tests/manual runs are
 * reproducible without regenerating.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, Packer, Paragraph, HeadingLevel } from "docx";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../tests/fixtures");

function doc(paras: { text: string; heading?: boolean }[]) {
  return new Document({
    sections: [
      {
        children: paras.map(
          (p) =>
            new Paragraph(
              p.heading ? { text: p.text, heading: HeadingLevel.HEADING_2 } : { text: p.text }
            )
        ),
      },
    ],
  });
}

const before = doc([
  { text: "MASTER SERVICES AGREEMENT", heading: true },
  { text: "1. Indemnification. The Provider shall indemnify the Client up to a cap of $1,000,000." },
  { text: "2. Settlement. Invoices are settled within 10 working days." },
  { text: "3. Governing Law. This agreement is governed by the laws of England." },
  { text: "4. Termination. Either party may terminate on 30 days notice." },
]);

const after = doc([
  { text: "MASTER SERVICES AGREEMENT", heading: true },
  { text: "1. Indemnification. The Provider shall indemnify the Client." }, // cap removed
  { text: "2. Settlement. Invoices are settled within 5 working days." }, // 10 -> 5
  { text: "3. Governing Law. This agreement is governed by the laws of England." }, // unchanged
  // clause 4 removed
  { text: "5. Confidentiality. Each party shall keep the other's information confidential." }, // added
]);

async function main() {
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "contract-A.docx"), await Packer.toBuffer(before));
  await writeFile(resolve(outDir, "contract-B.docx"), await Packer.toBuffer(after));
  console.log(`Wrote contract-A.docx and contract-B.docx to ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
