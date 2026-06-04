/**
 * Copy the docxodus .NET WASM runtime into public/wasm. Vite already does this
 * via vite-plugin-static-copy during dev/build; this script is a convenience for
 * inspecting the assets or for environments not driven by Vite.
 */
import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const src = resolve("node_modules/docxodus/dist/wasm");
const dest = resolve("public/wasm");

async function main() {
  if (!existsSync(src)) {
    console.error(`docxodus WASM not found at ${src} — run \`npm install\` first.`);
    process.exit(1);
  }
  await mkdir(dest, { recursive: true });
  await cp(src, dest, { recursive: true });
  console.log(`Copied docxodus WASM runtime to ${dest}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
