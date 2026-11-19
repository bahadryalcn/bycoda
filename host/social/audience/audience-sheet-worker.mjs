import { parentPort, workerData } from "node:worker_threads";
import { read, utils } from "xlsx";

/** A limit the owner can fix by splitting or trimming the file. Its message is shown as written. */
class SheetLimitError extends Error {}

const ZIP_END = 0x06054b50;
const ZIP_ENTRY = 0x02014b50;

/**
 * Sums the sizes the archive declares for its entries before any of them is inflated, so a small
 * file that expands to gigabytes is refused up front. Only the central directory is read.
 */
function assertArchiveSize(bytes, { maxUnzippedBytes, maxEntries }) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const floor = Math.max(0, bytes.length - 22 - 0xffff);
  let end = -1;
  for (let at = bytes.length - 22; at >= floor; at--) {
    if (view.getUint32(at, true) === ZIP_END) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new SheetLimitError("The file is not an .xlsx workbook.");
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff || start + size > end)
    throw new SheetLimitError("The workbook archive is not supported.");
  if (count > maxEntries) throw new SheetLimitError("The workbook has too many parts.");
  let total = 0;
  let at = start;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || view.getUint32(at, true) !== ZIP_ENTRY)
      throw new SheetLimitError("The workbook archive is damaged.");
    total += view.getUint32(at + 24, true);
    if (total > maxUnzippedBytes)
      throw new SheetLimitError("The workbook expands to more than the allowed size.");
    at +=
      46 +
      view.getUint16(at + 28, true) +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
  }
}

/**
 * First worksheet as rows of text. Only stored cells are visited, so a sheet that declares
 * A1:XFD1048576 never allocates a dense grid, and parsing stops after `maxSheetRows` rows.
 */
function firstSheetRows(bytes, limits) {
  const book = read(bytes, {
    type: "array",
    sheets: 0,
    sheetRows: limits.maxSheetRows + 1,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
  });
  const name = book.SheetNames[0];
  const sheet = name === undefined ? undefined : book.Sheets[name];
  if (!sheet) throw new SheetLimitError("The workbook has no sheet.");
  const declared = sheet["!fullref"] ?? sheet["!ref"];
  if (!declared) return [];
  const range = utils.decode_range(declared);
  if (range.e.r + 1 > limits.maxSheetRows || range.e.c + 1 > limits.maxColumns)
    throw new SheetLimitError(
      `The sheet is larger than ${limits.maxSheetRows} rows by ${limits.maxColumns} columns. Remove empty rows and columns or split the file.`,
    );
  const byRow = new Map();
  for (const address in sheet) {
    if (address.startsWith("!")) continue;
    const cell = sheet[address];
    if (!cell || cell.v == null) continue;
    const { r, c } = utils.decode_cell(address);
    const text = utils.format_cell(cell);
    if (!text.trim()) continue;
    let cells = byRow.get(r);
    if (!cells) byRow.set(r, (cells = []));
    cells[c] = text;
  }
  const rows = [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, cells]) => Array.from(cells, (cell) => cell ?? ""));
  if (rows.length > limits.maxRows + 1)
    throw new SheetLimitError(
      `Import at most ${limits.maxRows} contacts per file. Split the file.`,
    );
  return rows;
}

try {
  const { bytes, limits } = workerData;
  assertArchiveSize(bytes, limits);
  parentPort.postMessage({ rows: firstSheetRows(bytes, limits) });
} catch (error) {
  parentPort.postMessage({
    error: error instanceof SheetLimitError ? error.message : "The spreadsheet could not be read.",
    limit: error instanceof SheetLimitError,
  });
}
