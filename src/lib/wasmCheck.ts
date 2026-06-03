/**
 * Feature-detect WebAssembly SIMD, which docxodus / react-docxodus-viewer hard-
 * require. On Linux this needs WebKitGTK >= 2.40; the system WebView is otherwise
 * fine on current macOS/Windows. We validate a tiny module that uses a v128
 * (`i8x16.splat`) instruction rather than trusting a coarse boolean.
 */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0,
  65, 0, 253, 15, 253, 98, 11,
]);

export function hasWasmSimd(): boolean {
  try {
    return (
      typeof WebAssembly === "object" &&
      typeof WebAssembly.validate === "function" &&
      WebAssembly.validate(SIMD_PROBE)
    );
  } catch {
    return false;
  }
}
