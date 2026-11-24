import { describe, expect, it } from "vitest";
import { fileViewKind, logLines } from "./fileViews";

describe("fileViewKind", () => {
  it("opens .json as a tree and .log as a log", () => {
    expect(fileViewKind("C:\\work\\package.json")).toBe("json");
    expect(fileViewKind("/var/app/Config.JSON")).toBe("json");
    expect(fileViewKind("/var/log/build.log")).toBe("log");
  });
  it("leaves other text files in the editor", () => {
    expect(fileViewKind("notes.txt")).toBeNull();
    expect(fileViewKind("app.log.md")).toBeNull();
    expect(fileViewKind("data.jsonl")).toBeNull();
    expect(fileViewKind("log")).toBeNull();
  });
});

describe("logLines", () => {
  it("splits on every line ending and drops the final empty line", () => {
    expect(logLines("a\r\nb\nc\n")).toEqual(["a", "b", "c"]);
    expect(logLines("")).toEqual([""]);
    expect(logLines("one")).toEqual(["one"]);
  });
});
