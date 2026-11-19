import { describe, expect, it } from "vitest";
import {
  MAX_DOCUMENT_BYTES,
  buildSheetGrid,
  columnLabel,
  DocumentProblemError,
  documentKind,
  documentProblem,
  documentSizeProblem,
  looksLikeSpreadsheet,
} from "./documentViewer";

describe("documentKind", () => {
  it("maps document extensions case-insensitively", () => {
    expect(documentKind("/w/spec.pdf")).toBe("pdf");
    expect(documentKind("/w/Report.DOCX")).toBe("docx");
    expect(documentKind("/w/old.doc")).toBe("doc");
    expect(documentKind("/w/book.xlsx")).toBe("spreadsheet");
    expect(documentKind("/w/macro.xlsm")).toBe("spreadsheet");
    expect(documentKind("C:\\w\\legacy.xls")).toBe("spreadsheet");
    expect(documentKind("remote://mac/repo/data.csv")).toBe("csv");
    expect(documentKind("C:\\w\\data.TSV")).toBe("tsv");
  });

  it("leaves text, images and extensionless names alone", () => {
    expect(documentKind("/w/main.rs")).toBeNull();
    expect(documentKind("/w/logo.png")).toBeNull();
    expect(documentKind("/w/LICENSE")).toBeNull();
    expect(documentKind("/w/.pdf")).toBeNull();
    expect(documentKind("/w/a.pdf/notes.txt")).toBeNull();
  });
});

describe("documentSizeProblem", () => {
  it("allows files up to the cap and reports a typed reason beyond it", () => {
    expect(documentSizeProblem(MAX_DOCUMENT_BYTES)).toBeNull();
    expect(documentSizeProblem(MAX_DOCUMENT_BYTES + 1)).toEqual({ reason: "tooLarge" });
  });
});

describe("documentProblem", () => {
  it("classifies password-protected files", () => {
    expect(documentProblem(new Error("No password given"))).toEqual({
      reason: "passwordProtected",
    });
    expect(documentProblem("File is password-protected")).toEqual({
      reason: "passwordProtected",
    });
  });

  it("keeps other messages as detail and empty ones as corrupt", () => {
    expect(documentProblem(new Error("Invalid PDF structure."))).toEqual({
      reason: "unreadable",
      detail: "Invalid PDF structure.",
    });
    expect(documentProblem(new Error(""))).toEqual({ reason: "corrupt" });
  });

  it("returns a thrown typed reason unchanged", () => {
    expect(documentProblem(new DocumentProblemError({ reason: "binaryData" }))).toEqual({
      reason: "binaryData",
    });
  });
});

describe("columnLabel", () => {
  it("counts like a spreadsheet", () => {
    expect(columnLabel(0)).toBe("A");
    expect(columnLabel(25)).toBe("Z");
    expect(columnLabel(26)).toBe("AA");
    expect(columnLabel(51)).toBe("AZ");
    expect(columnLabel(701)).toBe("ZZ");
    expect(columnLabel(702)).toBe("AAA");
  });
});

describe("buildSheetGrid", () => {
  it("pads ragged rows and stringifies cells", () => {
    const grid = buildSheetGrid([["a", 1], ["b"], [null, undefined, true]]);
    expect(grid.columns).toEqual(["A", "B", "C"]);
    expect(grid.rows).toEqual([
      ["a", "1", ""],
      ["b", "", ""],
      ["", "", "true"],
    ]);
    expect(grid.truncated).toBe(false);
  });

  it("caps rows and columns and reports the original size", () => {
    const cells = Array.from({ length: 10 }, (_, r) =>
      Array.from({ length: 6 }, (_, c) => `${r}:${c}`),
    );
    const grid = buildSheetGrid(cells, 10, 6, 4, 3);
    expect(grid.rows).toHaveLength(4);
    expect(grid.rows[0]).toEqual(["0:0", "0:1", "0:2"]);
    expect(grid.columns).toEqual(["A", "B", "C"]);
    expect(grid.totalRows).toBe(10);
    expect(grid.totalColumns).toBe(6);
    expect(grid.truncated).toBe(true);
  });

  it("is truncated when the sheet is larger than what was parsed", () => {
    const grid = buildSheetGrid([["x"]], 500, 1);
    expect(grid.truncated).toBe(true);
  });

  it("handles an empty sheet", () => {
    const grid = buildSheetGrid([]);
    expect(grid.columns).toEqual([]);
    expect(grid.rows).toEqual([]);
    expect(grid.truncated).toBe(false);
  });
});

describe("looksLikeSpreadsheet", () => {
  it("accepts ZIP and OLE2 containers only", () => {
    expect(looksLikeSpreadsheet(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toBe(true);
    expect(looksLikeSpreadsheet(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0]))).toBe(true);
    expect(looksLikeSpreadsheet(new TextEncoder().encode("a,b,c"))).toBe(false);
    expect(looksLikeSpreadsheet(new Uint8Array())).toBe(false);
  });
});
