import { describe, expect, it } from "vitest";
import type {
  GitChangedFile,
  GitConflictFile,
  GitConflictKind,
  GitDiffIndex,
} from "../../../platform/tauri/fs";
import {
  commitBlockedMessage,
  conflictCanCompare,
  conflictChoices,
  conflictHasFile,
  conflictKindInfo,
  needsLegacyConflictPoll,
  nextConflictedFile,
  operationSummary,
  resolveConflictState,
  sameConflicts,
  type ConflictRowKind,
} from "./conflictSection";

const KINDS: GitConflictKind[] = [
  "both-modified",
  "both-added",
  "deleted-by-us",
  "deleted-by-them",
  "added-by-us",
  "added-by-them",
  "both-deleted",
];

const file = (relative: string, overrides: Partial<GitChangedFile> = {}): GitChangedFile => ({
  path: `/repo/${relative}`,
  relative,
  status: "modified",
  additions: 1,
  deletions: 0,
  staged: false,
  unstaged: true,
  ...overrides,
});

const conflict = (relative: string, kind: GitConflictKind = "both-modified"): GitConflictFile => ({
  path: `/repo/${relative}`,
  relative,
  kind,
});

function index(overrides: Partial<GitDiffIndex> = {}): GitDiffIndex {
  return {
    branch: "main",
    head: "abc",
    files: [],
    additions: 0,
    deletions: 0,
    remote: null,
    upstream: null,
    defaultBranch: null,
    ahead: 0,
    behind: 0,
    aheadOfDefault: 0,
    headPushed: false,
    ...overrides,
  };
}

describe("kind badges", () => {
  it("give every kind its git code and an explanation", () => {
    expect(KINDS.map((kind) => conflictKindInfo(kind).letter)).toEqual([
      "UU",
      "AA",
      "DU",
      "UD",
      "AU",
      "UA",
      "DD",
    ]);
    for (const kind of [...KINDS, "unknown" as const]) {
      expect(conflictKindInfo(kind).title.length).toBeGreaterThan(20);
    }
  });
});

describe("which choices apply to which kind", () => {
  const ids = (kind: ConflictRowKind) => conflictChoices(kind).map((choice) => choice.id);

  it("offers Accept Both only for content conflicts", () => {
    expect(ids("both-modified")).toEqual(["current", "incoming", "both"]);
    expect(ids("both-added")).toEqual(["current", "incoming", "both"]);
    for (const kind of KINDS.slice(2)) expect(ids(kind)).not.toContain("both");
    expect(ids("unknown")).toEqual(["current", "incoming"]);
  });

  it("offers Keep and Delete for delete conflicts, each adopting the side that matches", () => {
    const sides = (kind: ConflictRowKind) =>
      Object.fromEntries(conflictChoices(kind).map((choice) => [choice.id, choice.side]));
    // We deleted it: the current side is the deletion, the incoming side has the file.
    expect(sides("deleted-by-us")).toEqual({ keep: "theirs", delete: "ours" });
    // They deleted it: the incoming side is the deletion.
    expect(sides("deleted-by-them")).toEqual({ keep: "ours", delete: "theirs" });
    expect(sides("added-by-us")).toEqual({ keep: "ours", delete: "theirs" });
    expect(sides("added-by-them")).toEqual({ keep: "theirs", delete: "ours" });
    expect(sides("both-deleted")).toEqual({ delete: "ours" });
  });

  it("knows which kinds have a file to open and versions to compare", () => {
    expect(conflictHasFile("both-deleted")).toBe(false);
    expect(KINDS.filter((kind) => !conflictHasFile(kind))).toEqual(["both-deleted"]);
    expect(conflictCanCompare("both-modified")).toBe(true);
    expect(conflictCanCompare("deleted-by-us")).toBe(true);
    expect(conflictCanCompare("both-deleted")).toBe(false);
    expect(conflictCanCompare("unknown")).toBe(false);
  });
});

describe("resolveConflictState", () => {
  it("takes an index that carries conflicts as the whole truth", () => {
    const state = resolveConflictState(
      "/repo",
      index({
        files: [file("a.ts")],
        conflicts: [conflict("b.ts"), conflict("c.ts", "both-added")],
        operation: "merge",
      }),
      { operation: null, conflicts: ["ignored.ts"] },
    );
    expect(state).toMatchObject({ operation: "merge", source: "index" });
    expect(state.conflicts.map((c) => c.relative)).toEqual(["b.ts", "c.ts"]);
    expect(state.files.map((f) => f.relative)).toEqual(["a.ts"]);
  });

  it("treats an empty list from a new host as no conflicts, without polling", () => {
    const current = index({ files: [file("a.ts")], conflicts: [], operation: null });
    expect(resolveConflictState("/repo", current, null)).toMatchObject({
      conflicts: [],
      source: "index",
    });
    expect(needsLegacyConflictPoll(current)).toBe(false);
  });

  it("lifts conflicted paths out of an older host's files using the status commands", () => {
    const old = index({
      files: [file("a.ts"), file("b.ts", { staged: true }), file("sub/c.ts")],
    });
    expect(needsLegacyConflictPoll(old)).toBe(true);
    const state = resolveConflictState("/repo/", old, {
      operation: "rebase",
      conflicts: ["b.ts", "sub/c.ts", "gone.ts"],
    });
    expect(state.source).toBe("legacy");
    expect(state.operation).toBe("rebase");
    expect(state.files.map((f) => f.relative)).toEqual(["a.ts"]);
    expect(state.conflicts).toEqual([
      { path: "/repo/b.ts", relative: "b.ts", kind: "unknown" },
      { path: "/repo/sub/c.ts", relative: "sub/c.ts", kind: "unknown" },
      { path: "/repo/gone.ts", relative: "gone.ts", kind: "unknown" },
    ]);
  });

  it("shows nothing extra from a host that has neither", () => {
    const old = index({ files: [file("a.ts")] });
    expect(resolveConflictState("/repo", old, null)).toEqual({
      conflicts: [],
      files: old.files,
      operation: null,
      source: "none",
    });
    expect(resolveConflictState("/repo", old, { operation: null, conflicts: [] }).files).toBe(
      old.files,
    );
    expect(resolveConflictState("/repo", null, null).files).toEqual([]);
    expect(needsLegacyConflictPoll(null)).toBe(false);
  });
});

describe("commit blocking", () => {
  it("names the conflicted files", () => {
    expect(commitBlockedMessage([])).toBeNull();
    expect(commitBlockedMessage([{ relative: "a.ts" }])).toBe(
      "Resolve the merge conflict before committing: a.ts",
    );
    expect(commitBlockedMessage(["a", "b", "c", "d", "e"].map((relative) => ({ relative })))).toBe(
      "Resolve 5 merge conflicts before committing: a, b, c and 2 more",
    );
  });
});

describe("operationSummary", () => {
  it("counts what is left", () => {
    expect(operationSummary("Merge", 3)).toBe("Merge in progress · 3 conflicts");
    expect(operationSummary("Rebase", 1)).toBe("Rebase in progress · 1 conflict");
    expect(operationSummary("Cherry-pick", 0)).toBe("Cherry-pick in progress · no conflicts left");
  });
});

describe("nextConflictedFile", () => {
  it("moves on to the next file and wraps", () => {
    const all = ["a", "b", "c"];
    expect(nextConflictedFile(all, "a")).toBe("b");
    expect(nextConflictedFile(all, "c")).toBe("a");
    expect(nextConflictedFile(all, null)).toBe("a");
  });

  it("has nowhere to go when this is the only conflicted file", () => {
    expect(nextConflictedFile(["a"], "a")).toBeNull();
    expect(nextConflictedFile([], "a")).toBeNull();
  });

  it("starts from the top when the current file is no longer conflicted", () => {
    expect(nextConflictedFile(["b", "c"], "a")).toBe("b");
  });
});

describe("sameConflicts", () => {
  it("compares rows by path and kind", () => {
    expect(sameConflicts([conflict("a")], [conflict("a")])).toBe(true);
    expect(sameConflicts([conflict("a")], [conflict("a", "both-added")])).toBe(false);
    expect(sameConflicts([conflict("a")], [])).toBe(false);
    expect(sameConflicts(undefined, undefined)).toBe(true);
    expect(sameConflicts(undefined, [])).toBe(false);
  });
});
