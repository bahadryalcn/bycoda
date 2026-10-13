import {
  columnLabel,
  MAX_DOCUMENT_BYTES,
  MAX_SHEET_COLUMNS,
  MAX_SHEET_ROWS,
} from "./documentViewer";
import type { Spreadsheet } from "./spreadsheet";

/** Parse as text, never formulas, dates, HTML or executable spreadsheet content. */
export function parseDelimitedPreview(bytes: Uint8Array, format: "csv" | "tsv"): Spreadsheet {
  if (bytes.byteLength > MAX_DOCUMENT_BYTES)
    throw new Error("File is too large to preview (maximum 25 MB).");
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  const text = new TextDecoder(encoding).decode(bytes).replace(/^\uFEFF/, "");
  if (text.includes("\0"))
    throw new Error("This file contains binary data and cannot be shown as a table.");
  const delimiter = format === "tsv" ? "\t" : detectDelimiter(text);
  const cells: Record<string, string> = {};
  let row = 0,
    column = 0,
    columns = 0,
    value = "",
    quoted = false,
    stored = 0,
    characters = 0;
  let limited = false,
    stopped = false,
    rowHasData = false;
  const field = () => {
    if (
      column < MAX_SHEET_COLUMNS &&
      row < MAX_SHEET_ROWS &&
      stored < 200_000 &&
      characters < 4_000_000
    ) {
      const shown = value.slice(0, Math.min(16_000, 4_000_000 - characters));
      if (shown) {
        cells[`${row}:${column}`] = shown;
        stored++;
        characters += shown.length;
      }
      if (shown.length < value.length) limited = true;
    } else limited = true;
    column++;
    columns = Math.max(columns, column);
    value = "";
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    rowHasData = true;
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        if (value.length < 16_001) value += '"';
        index++;
      } else if (quoted || value.length === 0) quoted = !quoted;
      else if (value.length < 16_001) value += char;
    } else if (!quoted && char === delimiter) field();
    else if (!quoted && (char === "\n" || char === "\r")) {
      field();
      row++;
      column = 0;
      rowHasData = false;
      if (char === "\r" && text[index + 1] === "\n") index++;
      if (
        (row >= MAX_SHEET_ROWS || stored >= 200_000 || characters >= 4_000_000) &&
        index + 1 < text.length
      ) {
        limited = true;
        stopped = true;
        break;
      }
    } else if (value.length < 16_001) value += char;
    else limited = true;
  }
  if (quoted && !stopped)
    throw new Error("A quoted table cell is not closed. Check the source file.");
  if (rowHasData && !stopped) {
    field();
    row++;
  }
  return {
    sheets: [
      {
        name: format.toUpperCase(),
        columns: Array.from({ length: Math.min(columns, MAX_SHEET_COLUMNS) }, (_, index) =>
          columnLabel(index),
        ),
        rowCount: row,
        totalRows: row,
        totalColumns: columns,
        cells,
        truncated: limited,
        budgetLimited: limited,
      },
    ],
    omittedSheets: 0,
  };
}

function detectDelimiter(text: string): string {
  const counts = new Map([
    [",", 0],
    [";", 0],
    ["\t", 0],
  ]);
  let quoted = false;
  for (let i = 0; i < Math.min(text.length, 65536); i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && counts.has(char)) counts.set(char, counts.get(char)! + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}
