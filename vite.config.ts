import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

// @tauri-apps/cli sets this when running on a device/remote host.
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Copy the entire docxodus .NET WASM runtime (dist/wasm/_framework + glue)
    // into public-served /wasm so the viewer can instantiate it locally.
    // ~37 MB; must include the whole tree, not a single .wasm file.
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/docxodus/dist/wasm/*",
          dest: "wasm",
        },
      ],
    }),
  ],

  // Vite options tailored for Tauri development.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      // Don't watch the Rust side from Vite.
      ignored: ["**/src-tauri/**"],
    },
  },

  // Produce assets the system WebView can run.
  build: {
    target: "es2021",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
