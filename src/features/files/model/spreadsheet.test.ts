import { describe, expect, it } from "vitest";
import { utils, write, type WorkBook } from "xlsx";
import { MAX_CELL_TEXT, MAX_SHEET_TEXT, parseSpreadsheet, workbookPreview } from "./spreadsheet";

describe("bounded sparse spreadsheet preview", () => {
  it("caps worksheet parsing as well as preview output in many-sheet workbooks", () => {
    const book = utils.book_new();
    for (let index = 0; index < 101; index++) {
      utils.book_append_sheet(book, utils.aoa_to_sheet([[index]]), `Sheet ${index}`);
    }
    const result = parseSpreadsheet(
      new Uint8Array(write(book, { type: "array", bookType: "xlsx" })),
    );
    expect(result.sheets).toHaveLength(100);
    expect(result.omittedSheets).toBe(1);
    expect(result.sheets[99].cells["0:0"]).toBe("99");
  });
  it("does not expand a fabricated million-row, XFD-wide sparse range or format out-of-bounds cells", () => {
    const sheet = {
      "!ref": "A1:XFD1048576",
      A1: { t: "s", v: "start" },
      A100000: { t: "s", v: "end" },
      XFD1: {
        t: "s",
        get v() {
          throw new Error("must not format wide cells");
        },
      },
    };
    const result = workbookPreview({
      SheetNames: ["Sparse"],
      Sheets: { Sparse: sheet },
    } as WorkBook).sheets[0];
    expect(result.rowCount).toBe(100_000);
    expect(result.columns).toHaveLength(200);
    expect(result.cells).toEqual({ "0:0": "start", "99999:0": "end" });
    expect(result.truncated).toBe(true);
  });

  it("limits per-cell and workbook text before transferring previews", () => {
    const sheet = utils.aoa_to_sheet(
      Array.from({ length: 300 }, () => ["x".repeat(MAX_CELL_TEXT + 1)]),
    );
    const result = workbookPreview({
      SheetNames: ["Text"],
      Sheets: { Text: sheet },
    }).sheets[0];
    expect(Object.values(result.cells).reduce((total, text) => total + text.length, 0)).toBe(
      MAX_SHEET_TEXT,
    );
    expect(Object.values(result.cells).every((text) => text.length <= MAX_CELL_TEXT)).toBe(true);
    expect(result.budgetLimited).toBe(true);
  });

  it("parses a real workbook preserving formatted values and original row indices", () => {
    const book = utils.book_new();
    utils.book_append_sheet(book, { "!ref": "A1:B3", B3: { t: "n", v: 0.5, z: "0%" } }, "Numbers");
    const result = parseSpreadsheet(
      new Uint8Array(write(book, { type: "array", bookType: "xlsx" })),
    );
    expect(result.sheets[0].cells).toEqual({ "2:1": "50%" });
    expect(result.sheets[0].rowCount).toBe(3);
  });
});
