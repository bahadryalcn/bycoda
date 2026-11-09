import { invoke } from "@tauri-apps/api/core";

export type TextFileSlice = { text: string; offset: number; end: number; size: number };

/** One read-only page (about 1 MB, whole lines) of a file too large for the editor. Local paths only. */
export function readTextFileSlice(path: string, offset: number): Promise<TextFileSlice> {
  return invoke<TextFileSlice>("read_text_file_slice", { path, offset });
}
