import { expect, it } from "vitest";
import { diffRuns } from "./ToolInspectionDiff";

const tones = (text: string) =>
  diffRuns(text).map(({ from, to, tone }) => [text.slice(from, to).trimEnd(), tone]);

it("keeps the file headers before the first hunk in the plain ink", () => {
  const text = "--- a/x.sql\n+++ b/x.sql\n@@ -1,2 +1,2 @@\n--- old note\n+-- new note\n keep\n";
  expect(tones(text)).toEqual([
    ["--- a/x.sql\n+++ b/x.sql\n@@ -1,2 +1,2 @@", "inherit"],
    ["--- old note", "removed"],
    ["+-- new note", "added"],
    [" keep", "inherit"],
  ]);
});

it("colours a preview without headers or hunks from its first line", () => {
  expect(tones("-old\n+new\n")).toEqual([
    ["-old", "removed"],
    ["+new", "added"],
  ]);
});
