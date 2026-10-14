import { read, utils, type WorkBook } from "xlsx";
import {
  columnLabel,
  looksLikeSpreadsheet,
  MAX_DOCUMENT_BYTES,
  MAX_SHEET_COLUMNS,
  MAX_SHEET_ROWS,
} from "./documentViewer";

export const MAX_SHEET_CELLS = 200_000;
export const MAX_SHEET_TEXT = 4_000_000;
export const MAX_CELL_TEXT = 16_000;
export const MAX_WORKBOOK_SHEETS = 100;
export type SparseSheet = {
  name: string;
  columns: string[];
  rowCount: number;
  totalRows: number;
  totalColumns: number;
  cells: Record<string, string>;
  truncated: boolean;
  budgetLimited: boolean;
};
export type Spreadsheet = { sheets: SparseSheet[]; omittedSheets: number };

/** Only stored cells inside the preview bounds are formatted. Empty slots never allocate. */
export function workbookPreview(book: WorkBook): Spreadsheet {
  let remainingCells = MAX_SHEET_CELLS;
  let remainingText = MAX_SHEET_TEXT;
  const sheets = book.SheetNames.slice(0, MAX_WORKBOOK_SHEETS).map((name) => {
    const sheet = book.Sheets[name];
    const parsed = sheet?.["!ref"] ? utils.decode_range(sheet["!ref"]) : null;
    const full = sheet?.["!fullref"] ? utils.decode_range(sheet["!fullref"]) : parsed;
    const totalRows = full ? full.e.r + 1 : 0;
    const totalColumns = full ? full.e.c + 1 : 0;
    const rowCount = Math.min(totalRows, MAX_SHEET_ROWS);
    const columnCount = Math.min(totalColumns, MAX_SHEET_COLUMNS);
    const cells: Record<string, string> = {};
    let budgetLimited = false;
    // Enumerating sparse keys also prevents a fabricated XFD1048576 range from
    // causing a dense rectangular conversion. Out-of-range cells are skipped
    // before formatting; SheetJS parsing itself is isolated in a timed worker.
    for (const address in sheet) {
      if (address.startsWith("!")) continue;
      const { r, c } = utils.decode_cell(address);
      if (r >= rowCount || c >= columnCount || r < 0 || c < 0) continue;
      const cell = sheet[address];
      if (!cell || cell.v == null) continue;
      if (remainingCells <= 0 || remainingText <= 0) {
        budgetLimited = true;
        break;
      }
      const formatted = utils.format_cell(cell);
      const text = formatted.slice(0, Math.min(MAX_CELL_TEXT, remainingText));
      if (text.length < formatted.length) budgetLimited = true;
      cells[`${r}:${c}`] = text;
      remainingCells--;
      remainingText -= text.length;
    }
    return {
      name,
      columns: Array.from({ length: columnCount }, (_, c) => columnLabel(c)),
      rowCount,
      totalRows,
      totalColumns,
      cells,
      budgetLimited,
      truncated: rowCount < totalRows || columnCount < totalColumns || budgetLimited,
    };
  });
  return {
    sheets,
    omittedSheets: Math.max(0, book.SheetNames.length - sheets.length),
  };
}

export function parseSpreadsheet(bytes: Uint8Array): Spreadsheet {
  if (bytes.byteLength > MAX_DOCUMENT_BYTES)
    throw new Error("File is too large to preview (maximum 25 MB).");
  if (!looksLikeSpreadsheet(bytes))
    throw new Error("This isn’t a valid Excel workbook; the file may be corrupt.");
  // Discover names without loading worksheet contents, then limit worksheet
  // parsing too (not just the returned preview) for many-sheet workbooks.
  const names = read(bytes, { type: "array", bookSheets: true }).SheetNames;
  const selected = Array.from(
    { length: Math.min(names.length, MAX_WORKBOOK_SHEETS) },
    (_, index) => index,
  );
  return workbookPreview(
    read(bytes, {
      type: "array",
      sheets: selected,
      dense: false,
      sheetRows: MAX_SHEET_ROWS + 1,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
    }),
  );
}
