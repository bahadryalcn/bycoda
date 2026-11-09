import { checkDocxExpansion } from "../../files/model/docxPreview";

export type VoiceDocumentKind = "pdf" | "docx" | "spreadsheet";
export type VoiceDocumentText = {
  text: string;
  textLength: number;
  truncated: boolean;
  format: VoiceDocumentKind;
  coverage: "text-only";
};

export const VOICE_DOCUMENT_MAX_TEXT = 32_000;
export const VOICE_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
export const VOICE_DOCUMENT_MAX_SHEETS = 5;
export const VOICE_DOCUMENT_MAX_ROWS = 100;
export const VOICE_DOCUMENT_MAX_COLUMNS = 30;

/** The same bounded ZIP admission used by existing document previews, before inflation. */
export function checkVoiceOfficeDocument(bytes: Uint8Array) {
  if (!bytes.length || bytes.byteLength > VOICE_DOCUMENT_MAX_BYTES)
    throw new Error("Document size is outside the voice read limit.");
  checkDocxExpansion(bytes);
}

export async function parseVoiceOfficeDocument(
  bytes: Uint8Array,
  format: Exclude<VoiceDocumentKind, "pdf">,
): Promise<VoiceDocumentText> {
  checkVoiceOfficeDocument(bytes);
  if (format === "docx") {
    const { default: mammoth } = await import("mammoth/mammoth.browser");
    const result = await mammoth.extractRawText({
      arrayBuffer: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    });
    return {
      text: result.value.slice(0, VOICE_DOCUMENT_MAX_TEXT),
      textLength: result.value.length,
      truncated: result.value.length > VOICE_DOCUMENT_MAX_TEXT,
      format,
      coverage: "text-only",
    };
  }
  const { read, utils } = await import("xlsx");
  // Discover sheet names without loading cells, then constrain parsing itself.
  const names = read(bytes, { type: "array", bookSheets: true }).SheetNames;
  const book = read(bytes, {
    type: "array",
    sheets: Array.from({ length: Math.min(names.length, VOICE_DOCUMENT_MAX_SHEETS) }, (_, i) => i),
    sheetRows: VOICE_DOCUMENT_MAX_ROWS + 1,
    dense: false,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
  });
  let text = "";
  let truncated = names.length > VOICE_DOCUMENT_MAX_SHEETS;
  outer: for (const name of names.slice(0, VOICE_DOCUMENT_MAX_SHEETS)) {
    text += `Sheet: ${name}\n`;
    const sheet = book.Sheets[name];
    if (!sheet) continue;
    const range = sheet["!fullref"] ?? sheet["!ref"];
    if (range) {
      const bounds = utils.decode_range(range);
      truncated ||=
        bounds.e.r >= VOICE_DOCUMENT_MAX_ROWS || bounds.e.c >= VOICE_DOCUMENT_MAX_COLUMNS;
    }
    // Iterate stored cells rather than a potentially fabricated huge rectangular range.
    for (const address in sheet) {
      if (address.startsWith("!")) continue;
      const { r, c } = utils.decode_cell(address);
      if (r < 0 || c < 0 || r >= VOICE_DOCUMENT_MAX_ROWS || c >= VOICE_DOCUMENT_MAX_COLUMNS) {
        truncated = true;
        continue;
      }
      const cell = sheet[address];
      if (!cell || cell.v == null) continue;
      text += `${address}: ${utils.format_cell(cell)}\n`;
      if (text.length > VOICE_DOCUMENT_MAX_TEXT) {
        truncated = true;
        break outer;
      }
    }
  }
  return {
    text: text.slice(0, VOICE_DOCUMENT_MAX_TEXT),
    textLength: text.length,
    truncated,
    format,
    coverage: "text-only",
  };
}
