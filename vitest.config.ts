import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so unit tests don't pull in the Tauri/WASM
// static-copy plugins (which need node_modules/docxodus present).
export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
