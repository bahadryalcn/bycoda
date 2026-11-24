/** Viewer a file opens in beside its editor: a JSON tree, or a log with colors and line numbers. */
export type FileViewKind = "json" | "log";

/** `.json` files get a tree; `.log` files get a log view. Other text (including `.txt`) stays in the editor. */
export function fileViewKind(path: string): FileViewKind | null {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".log")) return "log";
  return null;
}

/** Lines of a log text; a trailing newline does not add an empty last line. */
export function logLines(text: string): string[] {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
