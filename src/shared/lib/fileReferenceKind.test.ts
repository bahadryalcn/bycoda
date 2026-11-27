import { describe, expect, it } from "vitest";
import {
  FILE_REF_KINDS,
  FILE_REF_TONES,
  FILE_REF_TONE_DEFAULTS,
  fileReferenceKind,
  isKnownFileType,
  splitFileLocation,
} from "./fileReferenceKind";

describe("fileReferenceKind", () => {
  it.each([
    ["App.tsx", "code"],
    ["src/main.rs", "code"],
    ["Dockerfile", "code"],
    ["index.html", "markup"],
    ["README.md", "docs"],
    ["ornek.pdf", "docs"],
    ["ornek.docx", "docs"],
    ["config.toml", "data"],
    ["rows.CSV", "data"],
    [".env.local", "data"],
    ["pnpm-lock.yaml", "data"],
    ["logo.svg", "media"],
    ["clip.mp4", "media"],
    ["backup.tar.gz", "archive"],
  ])("maps %s to %s", (name, kind) => {
    expect(fileReferenceKind(name, false)).toBe(kind);
  });

  it("calls any directory a folder and an unlisted file other", () => {
    expect(fileReferenceKind("src/", true)).toBe("folder");
    expect(fileReferenceKind("app.png", true)).toBe("folder");
    expect(fileReferenceKind("notes.weird", false)).toBe("other");
  });

  it("gives every kind a default tone from the fixed list", () => {
    for (const kind of FILE_REF_KINDS)
      expect(FILE_REF_TONES).toContain(FILE_REF_TONE_DEFAULTS[kind]);
  });
});

describe("isKnownFileType", () => {
  it.each([
    "images.generate",
    "logs.sources",
    "conversation_image_budget.session_id",
    "tabIndex",
    "console.log",
    "array.map",
    "process.env",
    "this.state",
    "obj.key",
  ])("does not treat the identifier %s as a file", (text) => {
    expect(isKnownFileType(text)).toBe(false);
  });

  it.each(["a/b/package.json", "Makefile", ".env", ".env.production", "x.test.ts", "C:/a/b.pdf"])(
    "recognises %s",
    (name) => {
      expect(isKnownFileType(name)).toBe(true);
    },
  );
});

describe("splitFileLocation", () => {
  it.each([
    ["projectNames.ts:13", "projectNames.ts", "L13"],
    ["src/a.ts:711:5", "src/a.ts", "L711:5"],
    ["src/a.ts#L13", "src/a.ts", "L13"],
    ["src/a.ts#L13-L20", "src/a.ts", "L13-20"],
  ])("splits %s", (text, name, location) => {
    expect(splitFileLocation(text)).toEqual({ name, location });
  });

  it("leaves text without a location and a bare number alone", () => {
    expect(splitFileLocation("src/a.ts")).toEqual({ name: "src/a.ts" });
    expect(splitFileLocation(":13")).toEqual({ name: ":13" });
    expect(splitFileLocation("C:/dir/a.ts")).toEqual({ name: "C:/dir/a.ts" });
  });
});
