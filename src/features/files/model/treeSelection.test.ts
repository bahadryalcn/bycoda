import { describe, expect, it } from "vitest";
import { selectTreePaths, topLevelTreePaths } from "./treeSelection";

describe("tree selection", () => {
  const visible = ["a", "folder", "folder/b", "c", "d"];
  it("toggles individual paths with Ctrl or Cmd", () => {
    expect([...selectTreePaths(new Set(["a"]), "c", "a", visible, { ctrlKey: true })]).toEqual([
      "a",
      "c",
    ]);
    expect([...selectTreePaths(new Set(["a", "c"]), "a", "c", visible, { metaKey: true })]).toEqual(
      ["c"],
    );
  });
  it("extends and shrinks ranges in rendered order", () => {
    expect([...selectTreePaths(new Set(["d"]), "a", "c", visible, { shiftKey: true })]).toEqual([
      "a",
      "folder",
      "folder/b",
      "c",
    ]);
    expect([
      ...selectTreePaths(new Set(visible), "folder/b", "c", visible, { shiftKey: true }),
    ]).toEqual(["folder/b", "c"]);
  });
  it("adds a range and handles an anchor hidden by collapse", () => {
    expect([
      ...selectTreePaths(new Set(["d"]), "folder/b", "folder", visible, {
        ctrlKey: true,
        shiftKey: true,
      }),
    ]).toEqual(["d", "folder", "folder/b"]);
    expect([
      ...selectTreePaths(new Set(["a"]), "c", "hidden", visible, { shiftKey: true }),
    ]).toEqual(["c"]);
  });
  it("processes selected descendants only once and respects path boundaries", () => {
    expect(topLevelTreePaths(["/a/b/c", "/a/b", "/a/b", "/a/bb", "/other"])).toEqual([
      "/a/b",
      "/a/bb",
      "/other",
    ]);
    expect(topLevelTreePaths(["C:\\a\\b", "C:\\a"])).toEqual(["C:\\a"]);
  });
});
