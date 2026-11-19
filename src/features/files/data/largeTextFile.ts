import { invokeWorkspace } from "../../../platform/tauri/fs";

/** `offset`/`end` are byte positions; `size` and `modifiedUs` identify the file version the page came from. */
export type TextFileSlice = {
  text: string;
  offset: number;
  end: number;
  size: number;
  modifiedUs: number;
};

/** The file version a paged view opened; later pages send it back so an edited file is refused. */
export type TextFileStamp = { size: number; modifiedUs: number };

/**
 * One read-only page (about 1 MB) of a file too large for the editor, on this computer or on
 * the connected machine that owns a remote path. `offset` is 0 or the `end` / `offset` of an
 * earlier page: a page that ended inside a line longer than a page continues from exactly that byte.
 */
export function readTextFileSlice(
  path: string,
  offset: number,
  expected: TextFileStamp | null,
): Promise<TextFileSlice> {
  return invokeWorkspace<TextFileSlice>("read_text_file_slice", { path, offset, expected });
}
