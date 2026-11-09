import { invokeWorkspace } from "../../platform/tauri/fs";

const MAX_FORMAT_CHARS = 512 * 1024;

/** Format with the owning machine's project formatter; null when the project has none. */
export async function formatProjectText(path: string, source: string, cursorOffset: number) {
  if (source.length > MAX_FORMAT_CHARS)
    throw new Error("File is too large to format (maximum 512 KB).");
  const result = await invokeWorkspace<{ formatted: string; cursorOffset: number } | null>(
    "format_text_file",
    { path, source, cursorOffset },
  );
  if (!result) return null;
  if (typeof result.formatted !== "string" || !Number.isSafeInteger(result.cursorOffset))
    throw new Error("Invalid project formatter response");
  return {
    formatted: result.formatted.replace(/\r\n?/g, "\n"),
    cursorOffset: result.formatted.slice(0, result.cursorOffset).replace(/\r\n?/g, "\n").length,
  };
}
