import { describe, expect, it } from "vitest";
import {
  MAX_EXTRA_FOLDERS,
  MAX_EXTRA_PORTS,
  formatFolders,
  formatPorts,
  isAbsolutePath,
  parseFolders,
  parsePorts,
} from "./scanSettings";

describe("parsePorts", () => {
  it("reads comma separated ports, trims spaces and drops duplicates", () => {
    expect(parsePorts(" 8080, 9000 ,8080, ")).toEqual({ ok: true, value: [8080, 9000] });
  });

  it("accepts the boundaries 1 and 65535 and treats empty text as no ports", () => {
    expect(parsePorts("1, 65535")).toEqual({ ok: true, value: [1, 65535] });
    expect(parsePorts("   ")).toEqual({ ok: true, value: [] });
  });

  it("rejects ports outside 1 to 65535, fractions and words", () => {
    for (const text of ["0", "65536", "99999", "80.5", "abc", "-1", "8080 9000"]) {
      expect(parsePorts(text)).toEqual({ ok: false, error: "invalid" });
    }
  });

  it("refuses more ports than the Host accepts", () => {
    const many = Array.from({ length: MAX_EXTRA_PORTS + 1 }, (_, index) => String(1000 + index));
    expect(parsePorts(many.join(","))).toEqual({ ok: false, error: "count" });
  });
});

describe("parseFolders", () => {
  it("reads one absolute folder per line and skips blank lines", () => {
    expect(parseFolders("D:\\Models\r\n\n/home/user/models\nD:\\Models")).toEqual({
      ok: true,
      value: ["D:\\Models", "/home/user/models"],
    });
  });

  it("refuses relative folders instead of sending them", () => {
    expect(parseFolders("models\\gguf")).toEqual({ ok: false, error: "relative" });
    expect(parseFolders("D:\\Models\n..\\other")).toEqual({ ok: false, error: "relative" });
  });

  it("refuses more folders than the Host accepts", () => {
    const many = Array.from({ length: MAX_EXTRA_FOLDERS + 1 }, (_, index) => `D:\\m${index}`);
    expect(parseFolders(many.join("\n"))).toEqual({ ok: false, error: "count" });
  });
});

describe("isAbsolutePath", () => {
  it("recognises drive, UNC and POSIX roots only", () => {
    expect(isAbsolutePath("C:\\x")).toBe(true);
    expect(isAbsolutePath("c:/x")).toBe(true);
    expect(isAbsolutePath("\\\\server\\share")).toBe(true);
    expect(isAbsolutePath("/var/models")).toBe(true);
    expect(isAbsolutePath("C:x")).toBe(false);
    expect(isAbsolutePath("models")).toBe(false);
  });
});

describe("format helpers", () => {
  it("round-trips the parsed values back into the form text", () => {
    expect(formatPorts([8080, 9000])).toBe("8080, 9000");
    expect(formatFolders(["D:\\Models", "/x"])).toBe("D:\\Models\n/x");
    expect(formatPorts([])).toBe("");
  });
});
