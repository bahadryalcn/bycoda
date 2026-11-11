import { describe, expect, it } from "vitest";
import { attachmentPresentation, formatAttachmentSize } from "./attachmentPresentation";
import type { Attachment } from "./session";

const file = (
  name: string,
  mimeType = "application/octet-stream",
  kind: Attachment["kind"] = "file",
) => ({ name, mimeType, kind });

describe("attachmentPresentation", () => {
  it.each([
    [0, null],
    [512, "512 B"],
    [1_153, "1 KB"],
    [1_572_864, "1.5 MB"],
    [Number.NaN, null],
  ])("keeps attachment size presentation for %s bytes", (size, expected) => {
    expect(formatAttachmentSize(size)).toBe(expected);
  });

  it.each([
    ["photo.PNG", "image"],
    ["voice.M4A", "audio"],
    ["clip.MOV", "video"],
    ["report.PDF", "pdf"],
    ["notes.MD", "markdown"],
    ["debug.log", "text"],
    ["component.tsx", "code"],
    ["backup.tar.gz", "archive"],
    ["unknown.bin", "file"],
  ])("classifies %s by extension when MIME is generic", (name, kind) => {
    expect(attachmentPresentation(file(name)).kind).toBe(kind);
  });

  it("uses explicit MIME before conflicting names and legacy kinds", () => {
    expect(attachmentPresentation(file("photo.png", "VIDEO/MP4; codecs=avc1", "image")).kind).toBe(
      "video",
    );
    expect(attachmentPresentation(file("notes.md", "application/pdf")).kind).toBe("pdf");
    expect(attachmentPresentation(file("sound.bin", "audio/ogg")).kind).toBe("audio");
  });

  it("retains specific text formats behind generic text/plain MIME", () => {
    expect(attachmentPresentation(file("README.md", "text/plain")).kind).toBe("markdown");
    expect(attachmentPresentation(file("main.py", "text/plain")).kind).toBe("code");
    expect(attachmentPresentation(file("README", "text/plain")).kind).toBe("text");
  });

  it("handles extensionless MIME types and legacy image/audio kinds", () => {
    expect(attachmentPresentation(file("recording", "", "audio")).kind).toBe("audio");
    expect(attachmentPresentation(file("clipboard", "", "image")).kind).toBe("image");
    expect(attachmentPresentation(file("document", "text/markdown")).label).toBe("Markdown");
    expect(attachmentPresentation(file("source", "application/json")).kind).toBe("code");
    expect(attachmentPresentation(file("backup", "application/zip")).kind).toBe("archive");
  });

  it("identifies folders despite file-like names", () => {
    expect(attachmentPresentation(file("archive.pdf", "inode/directory"))).toEqual({
      kind: "folder",
      label: "Folder",
      extension: "",
      typeExtension: null,
    });
  });

  it("does not infer a format from a dotfile or dots in directories", () => {
    expect(attachmentPresentation(file("C:\\project.md\\.env")).extension).toBe("");
    expect(attachmentPresentation(file("project.pdf/README")).kind).toBe("file");
  });

  it("retains presentation for missing attachments without requiring bytes", () => {
    const missing = { ...file("missing.pdf"), missing: true };
    expect(attachmentPresentation(missing)).toEqual({
      kind: "pdf",
      label: "PDF",
      extension: "pdf",
      typeExtension: null,
    });
  });

  it("classifies spreadsheets and shows the file extension as the type", () => {
    expect(attachmentPresentation(file("data.csv", "text/csv"))).toEqual({
      kind: "spreadsheet",
      label: "Spreadsheet",
      extension: "csv",
      typeExtension: "CSV",
    });
    expect(attachmentPresentation(file("data.tsv")).kind).toBe("spreadsheet");
    expect(attachmentPresentation(file("book", "application/vnd.ms-excel")).kind).toBe(
      "spreadsheet",
    );
    expect(
      attachmentPresentation(
        file("book.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      ).typeExtension,
    ).toBe("XLSX");
    expect(attachmentPresentation(file("a.json", "application/json")).typeExtension).toBe("JSON");
    expect(attachmentPresentation(file("a.zip", "application/zip")).typeExtension).toBe("ZIP");
    expect(attachmentPresentation(file("README", "text/plain")).typeExtension).toBeNull();
    expect(attachmentPresentation(file("report.pdf")).typeExtension).toBeNull();
  });
});
