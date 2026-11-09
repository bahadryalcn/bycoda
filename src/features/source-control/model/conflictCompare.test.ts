import { describe, expect, it } from "vitest";
import type { GitConflictStages } from "../../../platform/tauri/fs";
import { comparisonsFor, conflictImage, missingSideNotes } from "./conflictCompare";

const stages = (overrides: Partial<GitConflictStages> = {}): GitConflictStages => ({
  path: "/repo/a.txt",
  relative: "a.txt",
  kind: "both-modified",
  base: "base\n",
  ours: "ours\n",
  theirs: "theirs\n",
  binary: false,
  tooLarge: false,
  ...overrides,
});

describe("comparisonsFor", () => {
  it("pairs current with incoming, and each with the base", () => {
    const pairs = comparisonsFor(stages());
    expect(pairs.map((pair) => [pair.id, pair.original, pair.current])).toEqual([
      ["sides", "ours\n", "theirs\n"],
      ["base-current", "base\n", "ours\n"],
      ["base-incoming", "base\n", "theirs\n"],
    ]);
    expect(pairs.every((pair) => !pair.unavailable)).toBe(true);
  });

  it("disables the base pairs when both sides added the file", () => {
    const pairs = comparisonsFor(stages({ kind: "both-added", base: null }));
    expect(pairs[0].unavailable).toBeUndefined();
    expect(pairs[1].unavailable).toMatch(/no common base/);
    expect(pairs[2].unavailable).toMatch(/no common base/);
  });

  it("compares a deleted side as an empty file", () => {
    const pairs = comparisonsFor(stages({ kind: "deleted-by-us", ours: null }));
    expect(pairs[0]).toMatchObject({ original: "", current: "theirs\n" });
    expect(pairs[1]).toMatchObject({ original: "base\n", current: "" });
  });
});

describe("missingSideNotes", () => {
  it("says which side has no version of the file", () => {
    expect(missingSideNotes(stages())).toEqual([]);
    expect(missingSideNotes(stages({ ours: null }))).toEqual([
      "The current branch has no version of this file.",
    ]);
    expect(missingSideNotes(stages({ theirs: null })).join(" ")).toMatch(/incoming branch has no/);
  });
});

describe("conflictImage", () => {
  const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0));
  const image = stages({
    relative: "a.png",
    binary: true,
    base: "",
    ours: "",
    theirs: null,
    images: { base: btoa("<html>"), ours: png, theirs: null },
  });

  it("shows a version whose bytes are an image", () => {
    expect(conflictImage(image, "ours")).toEqual({
      status: "image",
      src: `data:image/png;base64,${png}`,
      bytes: 9,
    });
  });

  it("refuses bytes that are not an image, whatever the name", () => {
    expect(conflictImage(image, "base")).toEqual({ status: "unreadable" });
  });

  it("tells a missing version apart from one it cannot show", () => {
    expect(conflictImage(image, "theirs")).toEqual({ status: "missing" });
    expect(conflictImage(stages({ images: null }), "ours")).toEqual({ status: "unreadable" });
  });

  it("names the stages each pair shows", () => {
    expect(comparisonsFor(stages()).map((pair) => pair.sides)).toEqual([
      ["ours", "theirs"],
      ["base", "ours"],
      ["base", "theirs"],
    ]);
  });
});
