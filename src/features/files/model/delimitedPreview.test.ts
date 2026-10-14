import { describe, expect, it } from "vitest";
import { parseDelimitedPreview } from "./delimitedPreview";
const bytes = (text: string) => new TextEncoder().encode(text);

describe("delimited table preview", () => {
  it("preserves quoted delimiters, multiline cells, escaped quotes and literal formulas", () => {
    const result = parseDelimitedPreview(
      bytes('Name,Note,Value\r\n"Ada, L.","first\nsecond ""line""",=SUM(A1:A2)\r\n'),
      "csv",
    ).sheets[0];
    expect(result.columns).toEqual(["A", "B", "C"]);
    expect(result.rowCount).toBe(2);
    expect(result.cells["1:0"]).toBe("Ada, L.");
    expect(result.cells["1:1"]).toBe('first\nsecond "line"');
    expect(result.cells["1:2"]).toBe("=SUM(A1:A2)");
  });
  it("recognizes semicolon exports, TSV and UTF-16 BOMs", () => {
    expect(parseDelimitedPreview(bytes("Ad;Tutar\nÇağrı;1,25"), "csv").sheets[0].cells["1:1"]).toBe(
      "1,25",
    );
    expect(parseDelimitedPreview(bytes("a\tb\n1\t2"), "tsv").sheets[0].cells["1:1"]).toBe("2");
    expect(
      parseDelimitedPreview(new Uint8Array([255, 254, 65, 0, 44, 0, 66, 0]), "csv").sheets[0].cells,
    ).toEqual({ "0:0": "A", "0:1": "B" });
  });
  it("bounds rows, columns and cell text without densifying the preview", () => {
    const result = parseDelimitedPreview(
      bytes(`${"x".repeat(20_000)},${",".repeat(210)}\n${"a\n".repeat(100_001)}`),
      "csv",
    ).sheets[0];
    expect(result.columns).toHaveLength(200);
    expect(result.rowCount).toBe(100_000);
    expect(result.cells["0:0"]).toHaveLength(16_000);
    expect(result.truncated).toBe(true);
    expect(Object.keys(result.cells).length).toBeLessThanOrEqual(100_000);
  });
  it("rejects corrupt/binary input and handles empty files", () => {
    expect(() => parseDelimitedPreview(bytes('a,"unterminated'), "csv")).toThrow("not closed");
    expect(() => parseDelimitedPreview(bytes("binary\0data"), "csv")).toThrow("binary");
    expect(parseDelimitedPreview(bytes(""), "csv").sheets[0].rowCount).toBe(0);
  });
});
