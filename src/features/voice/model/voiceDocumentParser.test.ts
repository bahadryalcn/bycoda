import { expect, it } from "vitest";
import { CFB, utils, write } from "xlsx";
import {
  checkVoiceOfficeDocument,
  parseVoiceOfficeDocument,
  VOICE_DOCUMENT_MAX_BYTES,
  VOICE_DOCUMENT_MAX_TEXT,
} from "./voiceDocumentParser";

function workbook(sheets: Record<string, unknown[][]>) {
  const book = utils.book_new();
  for (const [name, rows] of Object.entries(sheets))
    utils.book_append_sheet(book, utils.aoa_to_sheet(rows), name);
  return new Uint8Array(write(book, { type: "array", bookType: "xlsx" }));
}

it("extracts DOCX paragraph text through the installed Mammoth parser", async () => {
  const archive = CFB.utils.cfb_new();
  const add = (path: string, content: string) =>
    CFB.utils.cfb_add(archive, path, new TextEncoder().encode(content));
  add(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  add(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  add(
    "word/document.xml",
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Voice document facts</w:t></w:r></w:p></w:body></w:document>',
  );
  const bytes = new Uint8Array(CFB.write(archive, { type: "buffer", fileType: "zip" }));
  const result = await parseVoiceOfficeDocument(bytes, "docx");
  expect(result).toMatchObject({ format: "docx", coverage: "text-only", truncated: false });
  expect(result.text).toContain("Voice document facts");
});

it("extracts real Excel cells without evaluating formula contents or dense ranges", async () => {
  const bytes = workbook({
    Budget: [
      ["Name", "Amount"],
      ["Voice", 45],
    ],
  });
  const result = await parseVoiceOfficeDocument(bytes, "spreadsheet");
  expect(result).toMatchObject({ format: "spreadsheet", coverage: "text-only", truncated: false });
  expect(result.text).toContain("Sheet: Budget");
  expect(result.text).toContain("A2: Voice");
  expect(result.text).toContain("B2: 45");
});

it("labels sheet and row omissions instead of claiming full workbook coverage", async () => {
  const sheets = Object.fromEntries(
    Array.from({ length: 6 }, (_, i) => [
      `Sheet${i}`,
      Array.from({ length: 102 }, (_, r) => [`row${r}`]),
    ]),
  );
  const result = await parseVoiceOfficeDocument(workbook(sheets), "spreadsheet");
  expect(result.truncated).toBe(true);
  expect(result.text).not.toContain("Sheet: Sheet5");
  expect(result.text).not.toContain("row100");
  expect(result.text).toContain("row99");
});

it("bounds returned workbook text and rejects oversized input before parsing", async () => {
  const result = await parseVoiceOfficeDocument(
    workbook({ Notes: [["x".repeat(32_700)], ["tail"]] }),
    "spreadsheet",
  );
  expect(result.text.length).toBeLessThanOrEqual(VOICE_DOCUMENT_MAX_TEXT);
  expect(result.truncated).toBe(true);
  expect(() => checkVoiceOfficeDocument(new Uint8Array(VOICE_DOCUMENT_MAX_BYTES + 1))).toThrow();
  expect(() => checkVoiceOfficeDocument(new Uint8Array())).toThrow();
});

it("refuses malformed and expanded ZIP bombs before a parser inflates them", () => {
  expect(() => checkVoiceOfficeDocument(new Uint8Array([1, 2, 3]))).toThrow();
  const bytes = workbook({ Sheet: [["ok"]] });
  const view = new DataView(bytes.buffer);
  // Every central entry advertises the expanded payload size. Inflate that declaration.
  for (let i = 0; i < bytes.length - 28; i++)
    if (view.getUint32(i, true) === 0x02014b50) {
      view.setUint32(i + 24, 0x7fffffff, true);
      break;
    }
  expect(() => checkVoiceOfficeDocument(bytes)).toThrow();
});
