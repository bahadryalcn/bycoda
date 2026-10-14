export type DocumentKind = "pdf" | "docx" | "doc" | "spreadsheet" | "csv" | "tsv";

const KIND_BY_EXTENSION: Record<string, DocumentKind> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".doc": "doc",
  ".xlsx": "spreadsheet",
  ".xlsm": "spreadsheet",
  ".xls": "spreadsheet",
  ".csv": "csv",
  ".tsv": "tsv",
};

/**
 * The native binary reader and on-demand session attachment readers use this ceiling.
 * Connected project documents preflight their size before a chunked local transfer.
 */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** Preview extents. The worker stores only bounded populated cells, never a dense rectangle. */
export const MAX_SHEET_ROWS = 100_000;
export const MAX_SHEET_COLUMNS = 200;

/**
 * Which read-only document viewer owns a path, decided before anything is read.
 * Delimited text has both a table preview and an editable source view.
 */
export function documentKind(path: string): DocumentKind | null {
  // Shared with the parsing worker; keep this module free of native/UI imports.
  const name = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop()?.toLowerCase() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return KIND_BY_EXTENSION[name.slice(dot)] ?? null;
}

/** A readable reason the bytes can't be opened, or null when they can. */
export function documentSizeProblem(size: number): string | null {
  if (size <= MAX_DOCUMENT_BYTES) return null;
  return `File is too large to preview (maximum ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB).`;
}

/** Turn a library failure into text that says what to do about it. */
export function documentErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/password|encrypt/i.test(message) || /PasswordException/.test(String(cause))) {
    return "This file is password-protected. Open it in the default app instead.";
  }
  return message || "The file could not be read; it may be corrupt.";
}

/** Spreadsheet column label for a zero-based index: 0 → A, 26 → AA. */
export function columnLabel(index: number): string {
  let label = "";
  let n = index + 1;
  while (n > 0) {
    const rest = (n - 1) % 26;
    label = String.fromCharCode(65 + rest) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

export type SheetGrid = {
  columns: string[];
  rows: string[][];
  totalRows: number;
  totalColumns: number;
  truncated: boolean;
};

/**
 * Cap a sheet's formatted cell text to the rows and columns the grid shows.
 * Rows are padded to the visible column count so the grid stays rectangular.
 */
export function buildSheetGrid(
  cells: readonly (readonly unknown[])[],
  totalRows = cells.length,
  totalColumns = cells.reduce((max, row) => Math.max(max, row.length), 0),
  maxRows = MAX_SHEET_ROWS,
  maxColumns = MAX_SHEET_COLUMNS,
): SheetGrid {
  const columnCount = Math.min(totalColumns, maxColumns);
  // This small dense helper is also used by callers/tests with already-parsed
  // rows. Keep it bounded independently of the worker's sparse preview path.
  const rowLimit = Math.min(maxRows, Math.floor(200_000 / Math.max(1, columnCount)));
  let remainingText = 4_000_000;
  let textLimited = false;
  const rows = cells.slice(0, rowLimit).map((row) => {
    const out: string[] = [];
    for (let column = 0; column < columnCount; column += 1) {
      const value = row[column];
      const raw = value == null ? "" : String(value);
      const text = raw.slice(0, Math.min(16_000, remainingText));
      if (text.length < raw.length) textLimited = true;
      remainingText -= text.length;
      out.push(text);
    }
    return out;
  });
  return {
    columns: Array.from({ length: columnCount }, (_, index) => columnLabel(index)),
    rows,
    totalRows,
    totalColumns,
    truncated: totalRows > rows.length || totalColumns > columnCount || textLimited,
  };
}

/**
 * Whether bytes carry an Excel container signature (ZIP for .xlsx, OLE2 for
 * .xls and encrypted workbooks). SheetJS happily parses anything else as CSV
 * text, which would show a corrupt file as one cell of garbage.
 */
export function looksLikeSpreadsheet(bytes: Uint8Array): boolean {
  const zip = [0x50, 0x4b, 0x03, 0x04];
  const ole = [0xd0, 0xcf, 0x11, 0xe0];
  return [zip, ole].some((magic) => magic.every((byte, index) => bytes[index] === byte));
}
