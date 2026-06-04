import { invoke } from "@tauri-apps/api/core";

/** Read a file's bytes via the backend (returns an ArrayBuffer). */
export async function readBytes(path: string): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>("read_file", { path });
  return new Uint8Array(buf);
}

/** Write bytes to a path chosen by the user. */
export async function saveBytes(path: string, data: Uint8Array): Promise<void> {
  await invoke("save_bytes", { path, data: Array.from(data) });
}
