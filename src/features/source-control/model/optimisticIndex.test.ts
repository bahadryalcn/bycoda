import { describe, expect, it } from "vitest";
import type { GitChangedFile, GitDiffIndex } from "../../../platform/tauri/fs";
import { applyCommit, applyIndexAction } from "./optimisticIndex";

function file(relative: string, overrides: Partial<GitChangedFile> = {}): GitChangedFile {
  return {
    path: `/repo/${relative}`,
    relative,
    status: "modified",
    additions: 2,
    deletions: 1,
    staged: false,
    unstaged: true,
    ...overrides,
  };
}

function index(files: GitChangedFile[]): GitDiffIndex {
  return {
    branch: "main",
    head: "abc",
    files,
    additions: files.reduce((sum, entry) => sum + entry.additions, 0),
    deletions: files.reduce((sum, entry) => sum + entry.deletions, 0),
    remote: null,
    upstream: null,
    defaultBranch: null,
    ahead: 0,
    behind: 0,
    aheadOfDefault: 0,
    headPushed: false,
  };
}

const sides = (next: GitDiffIndex) =>
  next.files.map((entry) => [entry.relative, entry.status, entry.staged, entry.unstaged]);

describe("applyIndexAction", () => {
  it("updates only a selected set in one pass, preserving partial staged data on discard", () => {
    const start = index([file("a.ts"), file("b.ts", { staged: true }), file("c.ts")]);
    const paths = new Set(["a.ts", "b.ts"]);
    const staged = applyIndexAction(start, "stage", paths);
    expect(sides(staged)).toEqual([
      ["a.ts", "modified", true, false],
      ["b.ts", "modified", true, false],
      ["c.ts", "modified", false, true],
    ]);
    const discarded = applyIndexAction(start, "discard", paths);
    expect(sides(discarded)).toEqual([
      ["b.ts", "modified", true, false],
      ["c.ts", "modified", false, true],
    ]);
    expect(discarded.additions).toBe(4);
    expect(discarded.deletions).toBe(2);
    expect(start.files).toHaveLength(3);
  });

  it("stages one file and leaves the others", () => {
    const next = applyIndexAction(index([file("a.ts"), file("b.ts")]), "stage", "a.ts");
    expect(sides(next)).toEqual([
      ["a.ts", "modified", true, false],
      ["b.ts", "modified", false, true],
    ]);
  });

  it("turns a staged untracked file into an added one and back", () => {
    const staged = applyIndexAction(
      index([file("new.ts", { status: "untracked" })]),
      "stage",
      "new.ts",
    );
    expect(sides(staged)).toEqual([["new.ts", "added", true, false]]);
    const unstaged = applyIndexAction(staged, "unstage", "new.ts");
    expect(sides(unstaged)).toEqual([["new.ts", "untracked", false, true]]);
  });

  it("stages a partly staged file whole", () => {
    const next = applyIndexAction(index([file("a.ts", { staged: true })]), "stage", "a.ts");
    expect(sides(next)).toEqual([["a.ts", "modified", true, false]]);
  });

  it("applies to every file on that side without a path", () => {
    const start = index([file("a.ts"), file("b.ts", { staged: true, unstaged: false })]);
    expect(sides(applyIndexAction(start, "stage"))).toEqual([
      ["a.ts", "modified", true, false],
      ["b.ts", "modified", true, false],
    ]);
    expect(sides(applyIndexAction(start, "unstage"))).toEqual([
      ["a.ts", "modified", false, true],
      ["b.ts", "modified", false, true],
    ]);
  });

  it("discarding removes an unstaged file and its line counts", () => {
    const next = applyIndexAction(index([file("a.ts"), file("b.ts")]), "discard", "a.ts");
    expect(sides(next)).toEqual([["b.ts", "modified", false, true]]);
    expect([next.additions, next.deletions]).toEqual([2, 1]);
  });

  it("a commit takes the staged files and their line counts", () => {
    const next = applyCommit(
      index([
        file("a.ts", { staged: true, unstaged: false }),
        file("b.ts"),
        file("c.ts", { staged: true }),
      ]),
      false,
    );
    expect(sides(next)).toEqual([
      ["b.ts", "modified", false, true],
      ["c.ts", "modified", false, true],
    ]);
    expect([next.additions, next.deletions]).toEqual([4, 2]);
  });

  it("a commit of everything leaves no changes", () => {
    const next = applyCommit(index([file("a.ts"), file("b.ts", { staged: true })]), true);
    expect(next.files).toEqual([]);
    expect([next.additions, next.deletions]).toEqual([0, 0]);
  });

  it("discarding keeps the staged side of a file", () => {
    const next = applyIndexAction(index([file("a.ts", { staged: true })]), "discard");
    expect(sides(next)).toEqual([["a.ts", "modified", true, false]]);
  });
});
