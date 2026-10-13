import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGitAction } from "./git-actions";
import {
  conflictKind,
  conflictsFrom,
  hostConflictStages,
  hostOperationState,
  hostUnmerged,
  parseUnmerged,
} from "./git-conflicts";
import { hostGitAction, hostGitIndex } from "./workspace";
import parity from "./fixtures/git-conflicts-parity.json";

it("Rust ile ortak fixture üzerinde stage, whitespace path ve conflict türleri eşleşir", () => {
  expect(parseUnmerged(parity.listing)).toEqual(parity.entries);
  for (const example of parity.kinds)
    expect(conflictKind(new Set(example.stages))).toBe(example.kind);
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo() {
  const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-conflicts-")));
  dirs.push(cwd);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  const tryGit = (...args: string[]) => {
    try {
      git(...args);
      return true;
    } catch {
      return false;
    }
  };
  git("init", "-q");
  git("checkout", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.test");
  git("config", "commit.gpgsign", "false");
  // A Windows runner defaults to autocrlf=true, which rewrites the files these tests read back.
  git("config", "core.autocrlf", "false");
  const write = (name: string, text: string | Buffer) => {
    mkdirSync(join(cwd, name, ".."), { recursive: true });
    writeFileSync(join(cwd, name), text);
  };
  const read = (name: string) => readFileSync(join(cwd, name), "utf8");
  const commit = (message: string, ...files: string[]) => {
    git("add", ...(files.length ? files : ["-A"]));
    git("commit", "-q", "-m", message);
  };
  return { cwd, git, tryGit, write, read, commit };
}

/** main and side both change uu.txt (UU) and add aa.txt (AA); side deletes
 * du.txt that main changed (UD), main deletes ud.txt that side changed (DU). */
function mergeRepo() {
  const r = repo();
  for (const name of ["uu", "du", "ud", "keep"]) r.write(`${name}.txt`, "a\n");
  r.commit("init");
  r.git("checkout", "-q", "-b", "side");
  r.write("uu.txt", "side\n");
  r.write("ud.txt", "side\n");
  r.write("aa.txt", "side\n");
  rmSync(join(r.cwd, "du.txt"));
  r.commit("side");
  r.git("checkout", "-q", "main");
  r.write("uu.txt", "main\n");
  r.write("du.txt", "main\n");
  r.write("aa.txt", "main\n");
  rmSync(join(r.cwd, "ud.txt"));
  r.commit("main");
  expect(r.tryGit("merge", "side")).toBe(false);
  return r;
}

const kinds = async (cwd: string) =>
  (await hostUnmerged(cwd)).map((file) => [file.relative, file.kind]);

describe("conflict kinds", () => {
  it("follow the stages git keeps", () => {
    const kind = (...stages: number[]) => conflictKind(new Set(stages));
    expect(kind(1, 2, 3)).toBe("both-modified");
    expect(kind(2, 3)).toBe("both-added");
    expect(kind(1, 3)).toBe("deleted-by-us");
    expect(kind(1, 2)).toBe("deleted-by-them");
    expect(kind(2)).toBe("added-by-us");
    expect(kind(3)).toBe("added-by-them");
    expect(kind(1)).toBe("both-deleted");
  });

  it("parses the listing, odd paths included", () => {
    const entries = parseUnmerged(
      ["100644 aaa 1\tdir/a b.txt", "100644 bbb 2\tdir/a b.txt", "100644 ccc 3\tx", ""].join("\0"),
    );
    expect(entries).toEqual([
      { relative: "dir/a b.txt", stage: 1, sha: "aaa" },
      { relative: "dir/a b.txt", stage: 2, sha: "bbb" },
      { relative: "x", stage: 3, sha: "ccc" },
    ]);
    expect(conflictsFrom(entries)).toEqual([
      { relative: "dir/a b.txt", kind: "deleted-by-them" },
      { relative: "x", kind: "added-by-them" },
    ]);
    expect(parseUnmerged("")).toEqual([]);
  });
});

describe("the host index with conflicts", () => {
  it("lists each merge conflict once, in its own list", async () => {
    const r = mergeRepo();
    r.write("keep.txt", "a\nb\n");
    r.write("new.txt", "one\ntwo\n");
    const index = await hostGitIndex(r.cwd);
    expect(index.conflicts).toEqual([
      { path: "aa.txt", relative: "aa.txt", kind: "both-added" },
      { path: "du.txt", relative: "du.txt", kind: "deleted-by-them" },
      { path: "ud.txt", relative: "ud.txt", kind: "deleted-by-us" },
      { path: "uu.txt", relative: "uu.txt", kind: "both-modified" },
    ]);
    expect(index.operation).toBe("merge");
    // Only the ordinary edits remain, once each, and the counts skip the markers.
    expect(index.files.map((f) => [f.relative, f.status, f.staged, f.unstaged])).toEqual([
      ["keep.txt", "modified", false, true],
      ["new.txt", "untracked", false, true],
    ]);
    expect([index.additions, index.deletions]).toEqual([3, 0]);
  });

  it("reports a cherry-pick, a stash pop and a rebase", async () => {
    const pick = repo();
    pick.write("a.txt", "alpha\n");
    pick.commit("init");
    pick.git("checkout", "-q", "-b", "side");
    pick.write("a.txt", "side\n");
    pick.commit("side");
    pick.git("checkout", "-q", "main");
    pick.write("a.txt", "main\n");
    pick.commit("main");
    expect(pick.tryGit("cherry-pick", "side")).toBe(false);
    let index = await hostGitIndex(pick.cwd);
    expect([index.operation, index.files, await kinds(pick.cwd)]).toEqual([
      "cherry-pick",
      [],
      [["a.txt", "both-modified"]],
    ]);

    const stash = repo();
    stash.write("a.txt", "alpha\n");
    stash.commit("init");
    stash.write("a.txt", "stashed\n");
    stash.git("stash");
    stash.write("a.txt", "committed\n");
    stash.commit("main");
    expect(stash.tryGit("stash", "pop")).toBe(false);
    index = await hostGitIndex(stash.cwd);
    expect([index.operation, index.files, await kinds(stash.cwd)]).toEqual([
      null,
      [],
      [["a.txt", "both-modified"]],
    ]);

    const rebase = repo();
    rebase.write("a.txt", "base\n");
    rebase.commit("init");
    rebase.git("checkout", "-q", "-b", "feature");
    rebase.write("a.txt", "one\n");
    rebase.commit("feature one");
    rebase.git("checkout", "-q", "main");
    rebase.write("a.txt", "main\n");
    rebase.commit("main");
    rebase.git("checkout", "-q", "feature");
    expect(rebase.tryGit("rebase", "main")).toBe(false);
    expect((await hostGitIndex(rebase.cwd)).operation).toBe("rebase");
    expect(await hostOperationState(rebase.cwd)).toBe("rebase");
  });

  it("has no conflicts in a clean repository", async () => {
    const r = repo();
    r.write("a.txt", "one\n");
    r.commit("init");
    expect(await hostGitIndex(r.cwd)).toMatchObject({ conflicts: [], operation: null });
  });
});

describe("resolving on the host", () => {
  it("takes a side, including the deletion of a file the other side changed", async () => {
    const r = mergeRepo();
    const resolve = (relative: string, side: string) =>
      runGitAction("git_resolve_conflict", r.cwd, { relative, side });
    await resolve("ud.txt", "ours"); // we deleted it: ours is the deletion
    expect(existsSync(join(r.cwd, "ud.txt"))).toBe(false);
    await resolve("du.txt", "ours");
    expect(r.read("du.txt")).toBe("main\n");
    await resolve("aa.txt", "theirs");
    expect(r.read("aa.txt")).toBe("side\n");
    expect(await kinds(r.cwd)).toEqual([["uu.txt", "both-modified"]]);
    await expect(resolve("uu.txt", "mine")).rejects.toThrow("Invalid side");
    await expect(resolve("keep.txt", "ours")).rejects.toThrow("no merge conflict");
    await resolve("uu.txt", "theirs");
    expect((await hostGitIndex(r.cwd)).conflicts).toEqual([]);

    const other = mergeRepo();
    await runGitAction("git_resolve_conflict", other.cwd, { relative: "du.txt", side: "theirs" });
    expect(existsSync(join(other.cwd, "du.txt"))).toBe(false);
    await runGitAction("git_resolve_conflict", other.cwd, { relative: "ud.txt", side: "theirs" });
    expect(other.read("ud.txt")).toBe("side\n");
    expect((await kinds(other.cwd)).map(([name]) => name)).toEqual(["aa.txt", "uu.txt"]);
  });

  it("refuses to commit or continue while conflicts remain, and keeps Stage All off them", async () => {
    const r = mergeRepo();
    r.write("keep.txt", "edited\n");
    await hostGitAction(r.cwd, "stageAll");
    const index = await hostGitIndex(r.cwd);
    expect(index.conflicts).toHaveLength(4);
    expect(index.files.some((f) => f.relative === "keep.txt" && f.staged)).toBe(true);

    await expect(hostGitAction(r.cwd, "commit", undefined, "wip")).rejects.toThrow(
      /4 files.*uu\.txt/,
    );
    await expect(runGitAction("git_operation_continue", r.cwd, {})).rejects.toThrow(/aa\.txt/);
  });

  it("continues a rebase onto the next conflicting commit instead of failing", async () => {
    const r = repo();
    r.write("a.txt", "base\n");
    r.commit("init");
    r.git("checkout", "-q", "-b", "feature");
    r.write("a.txt", "one\n");
    r.commit("feature one");
    r.write("a.txt", "two\n");
    r.commit("feature two");
    r.git("checkout", "-q", "main");
    r.write("a.txt", "main\n");
    r.commit("main");
    r.git("checkout", "-q", "feature");
    expect(r.tryGit("rebase", "main")).toBe(false);

    r.write("a.txt", "merged\n");
    await hostGitAction(r.cwd, "stage", "a.txt");
    await runGitAction("git_operation_continue", r.cwd, {});
    expect(await hostOperationState(r.cwd)).toBe("rebase");
    expect(await kinds(r.cwd)).toEqual([["a.txt", "both-modified"]]);

    r.write("a.txt", "final\n");
    await hostGitAction(r.cwd, "stage", "a.txt");
    await runGitAction("git_operation_continue", r.cwd, {});
    expect(await hostOperationState(r.cwd)).toBeNull();
    expect((await hostGitIndex(r.cwd)).conflicts).toEqual([]);
  });
});

describe("the three versions of a conflicted file", () => {
  it("returns base, current and incoming, with a missing stage as null", async () => {
    const r = mergeRepo();
    expect(await runGitAction("git_conflict_stages", r.cwd, { relative: "uu.txt" })).toMatchObject({
      kind: "both-modified",
      base: "a\n",
      ours: "main\n",
      theirs: "side\n",
      binary: false,
      tooLarge: false,
    });
    expect(await hostConflictStages(r.cwd, "aa.txt")).toMatchObject({
      kind: "both-added",
      base: null,
      ours: "main\n",
      theirs: "side\n",
    });
    expect(await hostConflictStages(r.cwd, "ud.txt")).toMatchObject({
      kind: "deleted-by-us",
      ours: null,
      theirs: "side\n",
    });
    // Reading changes nothing.
    expect(await hostUnmerged(r.cwd)).toHaveLength(4);
  });

  it("confines the path and never reads it as an option", async () => {
    const r = mergeRepo();
    for (const relative of [
      "../a.txt",
      "/etc/passwd",
      ".git/config",
      "",
      "a\0b",
      7,
      "sub/../../a.txt",
    ])
      await expect(runGitAction("git_conflict_stages", r.cwd, { relative })).rejects.toThrow();
    for (const relative of ["keep.txt", "--help", "-u", "uu.txt/.."])
      await expect(runGitAction("git_conflict_stages", r.cwd, { relative })).rejects.toThrow();
  });

  it("flags binary files and returns no contents", async () => {
    const r = repo();
    r.write("b.bin", Buffer.from([0, 1, 2]));
    r.commit("init");
    r.git("checkout", "-q", "-b", "side");
    r.write("b.bin", Buffer.from([0, 9, 9]));
    r.commit("side");
    r.git("checkout", "-q", "main");
    r.write("b.bin", Buffer.from([0, 7, 7]));
    r.commit("main");
    expect(r.tryGit("merge", "side")).toBe(false);
    expect(await hostConflictStages(r.cwd, "b.bin")).toMatchObject({
      binary: true,
      base: "",
      ours: "",
      theirs: "",
    });
  });

  it("flags a version over the size cap", async () => {
    const r = repo();
    r.write("big.txt", "a\n");
    r.commit("init");
    r.git("checkout", "-q", "-b", "side");
    r.write("big.txt", "x".repeat(1024 * 1024 + 10));
    r.commit("side");
    r.git("checkout", "-q", "main");
    r.write("big.txt", "main\n");
    r.commit("main");
    expect(r.tryGit("merge", "side")).toBe(false);
    expect(await hostConflictStages(r.cwd, "big.txt")).toMatchObject({
      tooLarge: true,
      base: "",
      ours: "",
      theirs: "",
    });
  });
});
