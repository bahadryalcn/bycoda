import { errorText } from "../../../shared/lib/errors";

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

/**
 * Why a document can't be previewed. A reason, not a sentence: workers and parsers
 * stay free of UI imports, and `describeDocumentProblem` words it in the active
 * language. `unreadable` carries the library's or host's own text, which is shown
 * redacted and never translated.
 */
export type DocumentProblem =
  | { reason: "unreadable"; detail: string }
  | { reason: "timeout"; ms: number }
  | {
      reason:
        | "tooLarge"
        | "passwordProtected"
        | "corrupt"
        | "workerFailed"
        | "contentTooLarge"
        | "imagesTooLarge"
        | "notDocx"
        | "archiveIncomplete"
        | "archiveInconsistent"
        | "notWorkbook"
        | "unclosedQuote"
        | "binaryData"
        | "invalidPageSize"
        | "invalidRasterSize";
    };

/** Throwable form of a `DocumentProblem`; its message is a reason code for logs, not UI copy. */
export class DocumentProblemError extends Error {
  readonly problem: DocumentProblem;
  constructor(problem: DocumentProblem) {
    super(`Document problem: ${problem.reason}`);
    this.name = "DocumentProblemError";
    this.problem = problem;
  }
}

/** The reason the bytes can't be opened, or null when they can. */
export function documentSizeProblem(size: number): DocumentProblem | null {
  return size <= MAX_DOCUMENT_BYTES ? null : { reason: "tooLarge" };
}

/** The raw failure text a connection-error gate can recognize; only `unreadable` has any. */
export function documentProblemDetail(problem: DocumentProblem | null | undefined) {
  return problem?.reason === "unreadable" ? problem.detail : undefined;
}

/** Classify a library, host or parser failure; the viewer words the result. */
export function documentProblem(cause: unknown): DocumentProblem {
  if (cause instanceof DocumentProblemError) return cause.problem;
  const message = errorText(cause);
  if (/password|encrypt/i.test(message) || /PasswordException/.test(String(cause))) {
    return { reason: "passwordProtected" };
  }
  return message ? { reason: "unreadable", detail: message } : { reason: "corrupt" };
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
