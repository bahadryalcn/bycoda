import { describe, expect, it } from "vitest";
import type { GitChangedFile } from "../../../platform/tauri/fs";
import { workingTreeDiffEntries } from "./workingTreeDiff";
import {
  dirtyEntryIds,
  entriesToLoad,
  entriesToReload,
  reuseLoadedDiff,
  sameChangedFiles,
} from "./workingTreeReload";

function file(relative: string, over: Partial<GitChangedFile> = {}): GitChangedFile {
  return {
    path: `/repo/${relative}`,
    relative,
    status: "modified",
    additions: 1,
    deletions: 1,
    staged: false,
    unstaged: true,
    ...over,
  };
}

function loadedFor(files: GitChangedFile[]) {
  return new Map(workingTreeDiffEntries(files).map((entry) => [entry.id, entry.file]));
}

describe("entriesToReload", () => {
  const files = ["a.ts", "b.ts", "c.ts"].map((name) => file(name));

  it("reloads nothing when every row is as it was loaded", () => {
    const next = files.map((f) => ({ ...f }));
    expect(entriesToReload(workingTreeDiffEntries(next), loadedFor(files), new Set())).toEqual([]);
  });

  it("reloads a file whose counts, status or staged flags moved", () => {
    const next = [
      file("a.ts", { additions: 2 }),
      file("b.ts", { status: "deleted" }),
      file("c.ts", { staged: true }),
    ];
    const ids = entriesToReload(workingTreeDiffEntries(next), loadedFor(files), new Set()).map(
      (entry) => entry.id,
    );
    expect(ids).toEqual(["staged:c.ts", "unstaged:a.ts", "unstaged:b.ts", "unstaged:c.ts"]);
  });

  it("loads new files and ignores removed ones", () => {
    const next = [files[0], file("new.ts")];
    const ids = entriesToReload(workingTreeDiffEntries(next), loadedFor(files), new Set()).map(
      (entry) => entry.id,
    );
    expect(ids).toEqual(["unstaged:new.ts"]);
  });

  it("reloads a dirty file even when its row is identical", () => {
    const entries = workingTreeDiffEntries(files);
    const dirty = new Set(dirtyEntryIds(entries, new Set(["/repo/b.ts"])));
    expect(entriesToReload(entries, loadedFor(files), dirty).map((e) => e.id)).toEqual([
      "unstaged:b.ts",
    ]);
  });

  it("retries a file that never finished loading", () => {
    const entries = workingTreeDiffEntries(files);
    const loaded = loadedFor(files);
    loaded.delete("unstaged:a.ts");
    expect(entriesToReload(entries, loaded, new Set()).map((e) => e.id)).toEqual(["unstaged:a.ts"]);
  });
});

describe("entriesToLoad", () => {
  const files = Array.from({ length: 300 }, (_, i) => file(`f${i}.ts`));
  const entries = workingTreeDiffEntries(files);
  const none = new Set<string>();
  const ids = (list: { id: string }[]) => list.map((e) => e.id);

  it("opens a 300-file view with only the eager budget and what is needed", () => {
    const out = entriesToLoad(entries, new Map(), none, none, 10, none);
    expect(out).toHaveLength(10);
    const needed = new Set(["unstaged:f50.ts", "unstaged:f2.ts"]);
    const withNeeded = entriesToLoad(entries, new Map(), none, needed, 10, none);
    expect(withNeeded).toHaveLength(11);
    expect(ids(withNeeded)).toContain("unstaged:f50.ts");
  });

  it("does not load collapsed or off-screen entries beyond the budget", () => {
    const out = entriesToLoad(entries, new Map(), none, none, 0, none);
    expect(out).toEqual([]);
  });

  it("leaves a dirty entry unloaded until it is needed", () => {
    const loaded = loadedFor(files);
    const dirty = new Set(["unstaged:f200.ts"]);
    expect(entriesToLoad(entries, loaded, dirty, none, 10, none)).toEqual([]);
    const needed = new Set(["unstaged:f200.ts"]);
    expect(ids(entriesToLoad(entries, loaded, dirty, needed, 10, none))).toEqual([
      "unstaged:f200.ts",
    ]);
  });

  it("reloads a dirty entry inside the eager budget at once", () => {
    const loaded = loadedFor(files);
    const dirty = new Set(["unstaged:f3.ts"]);
    expect(ids(entriesToLoad(entries, loaded, dirty, none, 10, none))).toEqual(["unstaged:f3.ts"]);
  });

  it("skips entries in flight or failed", () => {
    const skip = new Set(["unstaged:f0.ts"]);
    const out = entriesToLoad(entries, new Map(), none, none, 3, skip);
    expect(ids(out)).toEqual(["unstaged:f1.ts", "unstaged:f2.ts"]);
  });

  it("does not touch loaded, unchanged entries", () => {
    const needed = new Set(entries.map((e) => e.id));
    expect(entriesToLoad(entries, loadedFor(files), none, needed, 10, none)).toEqual([]);
  });
});

describe("dirtyEntryIds", () => {
  it("covers both sides of a file with staged and unstaged changes", () => {
    const entries = workingTreeDiffEntries([file("a.ts", { staged: true }), file("b.ts")]);
    expect(dirtyEntryIds(entries, new Set(["/repo/a.ts"]))).toEqual([
      "staged:a.ts",
      "unstaged:a.ts",
    ]);
  });

  it("marks everything when the change named no files", () => {
    const entries = workingTreeDiffEntries([file("a.ts"), file("b.ts")]);
    expect(dirtyEntryIds(entries, null)).toHaveLength(2);
  });
});

describe("sameChangedFiles", () => {
  it("compares rows by value and order", () => {
    const a = [file("a.ts"), file("b.ts")];
    expect(
      sameChangedFiles(
        a,
        a.map((f) => ({ ...f })),
      ),
    ).toBe(true);
    expect(sameChangedFiles(a, [a[1], a[0]])).toBe(false);
    expect(sameChangedFiles(a, [a[0]])).toBe(false);
  });
});

describe("reuseLoadedDiff", () => {
  const loaded = {
    binary: false,
    tooLarge: false,
    original: "a\n",
    current: "b\n",
    unified: { id: 1 } as { id: number } | null,
  };

  it("keeps the previous object for identical texts", () => {
    const next = { ...loaded, unified: null };
    expect(reuseLoadedDiff(loaded, next)).toBe(loaded);
  });

  it("takes the new object when a text differs", () => {
    const next = { ...loaded, current: "c\n", unified: null };
    expect(reuseLoadedDiff(loaded, next)).toBe(next);
  });

  it("never keeps an errored load", () => {
    const failed = { ...loaded, original: "", current: "", error: "x" };
    const same = { ...failed, error: undefined };
    expect(reuseLoadedDiff(failed, same)).toBe(same);
    expect(reuseLoadedDiff(undefined, same)).toBe(same);
  });
});
