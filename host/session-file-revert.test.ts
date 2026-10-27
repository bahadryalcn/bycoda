import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { execFileAsync } from "../src/shared/lib/processExecution.node";
import { HostCheckpoints } from "./checkpoints";
import { acquireRevertFileGuard, SessionFileRevert } from "./session-file-revert";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
});
async function fixture(gitRepo = true) {
  const root = await mkdtemp(join(tmpdir(), "bycoda-file-revert-"));
  roots.push(root);
  const cwd = join(root, "repo");
  await mkdir(cwd);
  const git = async (...args: string[]) =>
    (await execFileAsync("git", args, { cwd, windowsHide: true, encoding: "utf8" })).stdout.trim();
  await writeFile(join(cwd, "a.txt"), "base\n");
  if (gitRepo) {
    await git("init", "-q");
    await git("config", "user.name", "Test");
    await git("config", "user.email", "test@example.invalid");
    await git("config", "core.autocrlf", "false");
    await git("add", ".");
    await git("commit", "-qm", "initial");
  }
  const checkpoints = new HostCheckpoints(join(root, "checkpoints"));
  return {
    root,
    cwd,
    git,
    checkpoints,
    write: (path: string, text: string) => writeFile(join(cwd, path), text),
    read: (path: string) => readFile(join(cwd, path), "utf8"),
    turn: async (id: string, edit: () => Promise<unknown>) => {
      await checkpoints.beginFilesTurn("s", cwd, `run-${id}`, id);
      await edit();
      await checkpoints.finishFilesTurn("s", cwd, `run-${id}`);
    },
  };
}
describe("session message file revert", () => {
  it("retires committed aggregate review entries while retaining message history", async () => {
    const f = await fixture();
    await f.turn("one", () => f.write("a.txt", "committed\n"));
    await f.git("add", ".");
    await f.git("commit", "-qm", "accepted changes");
    await f.turn("two", () => f.write("new.txt", "new own\n"));
    const review = await f.checkpoints.status("s", f.cwd);
    expect(review.files.map((file) => file.path)).toEqual([join(f.cwd, "new.txt")]);
    expect(
      (await f.checkpoints.filesRevertPlan("s", f.cwd, "one")).files.map((file) => file.path),
    ).toContain("a.txt");
  });
  it("preserves existing checkpoint review and per-file Undo after a lightweight turn", async () => {
    const f = await fixture();
    await f.turn("one", () => f.write("a.txt", "mine\n"));
    const status = await f.checkpoints.status("s", f.cwd);
    expect(status.files).toHaveLength(1);
    expect(status.files[0].undoable).toBe(true);
    await f.checkpoints.change("s", f.cwd, "a.txt", true, status.expectedCheckpoint);
    expect(await f.read("a.txt")).toBe("base\n");
  });
  it("does not let stale legacy metadata block safe new files or authorize ambiguous old files", async () => {
    const f = await fixture();
    await f.turn("one", () => f.write("a.txt", "ambiguous old\n"));
    const manifest = join(f.root, "checkpoints", "s", "manifest.json");
    const record = JSON.parse(await readFile(manifest, "utf8"));
    record.shared = true;
    record.error = "old interrupted capture";
    await writeFile(manifest, JSON.stringify(record));
    await f.turn("two", () => f.write("new.txt", "new own\n"));
    const status = await f.checkpoints.status("s", f.cwd);
    expect(status.files.find((file) => file.path.endsWith("a.txt"))?.undoable).toBe(false);
    expect(status.files.find((file) => file.path.endsWith("new.txt"))?.undoable).toBe(true);
    await f.checkpoints.change("s", f.cwd, "new.txt", true, status.expectedCheckpoint);
    await expect(f.read("new.txt")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await f.read("a.txt")).toBe("ambiguous old\n");
  });
  it("retains Unicode and object-prototype-like filenames as ordinary files", async () => {
    const f = await fixture();
    await f.write("__proto__", "before\n");
    await f.write("çalışma.txt", "önce\n");
    await f.turn("one", async () => {
      await f.write("__proto__", "after\n");
      await f.write("çalışma.txt", "sonra\n");
    });
    const result = await f.checkpoints.filesRevert("s", f.cwd, "one");
    expect(result.skipped).toEqual([]);
    expect(result.reverted.sort()).toEqual(["__proto__", "çalışma.txt"].sort());
    expect(await f.read("__proto__")).toBe("before\n");
    expect(await f.read("çalışma.txt")).toBe("önce\n");
  });
  it.runIf(process.platform === "win32")(
    "holds parent directories and denies new writers until publication completes",
    async () => {
      const f = await fixture();
      await mkdir(join(f.cwd, "dir"));
      const path = join(f.cwd, "dir", "a.txt");
      await writeFile(path, "current\n");
      const guard = await acquireRevertFileGuard(f.cwd, path);
      try {
        await expect(rename(join(f.cwd, "dir"), join(f.cwd, "renamed"))).rejects.toThrow();
        await expect(open(path, "r+")).rejects.toThrow();
        await rename(path, join(f.cwd, "dir", "rescue"));
        await expect(open(join(f.cwd, "dir", "rescue"), "r+")).rejects.toThrow();
      } finally {
        await guard.release();
      }
      await rename(join(f.cwd, "dir"), join(f.cwd, "renamed"));
    },
  );
  it("never deletes an existing ignored file with missing pre-edit evidence", async () => {
    const f = await fixture();
    await f.write(".gitignore", "ignored.txt\n");
    await f.write("ignored.txt", "existing\n");
    await f.checkpoints.beginFilesTurn("s", f.cwd, "one");
    await f.write("ignored.txt", "mine\n");
    await f.checkpoints.claim("s", f.cwd, "one", ["ignored.txt"]);
    await f.checkpoints.finishFilesTurn("s", f.cwd, "one");
    expect((await f.checkpoints.filesRevert("s", f.cwd, "one")).skipped).toHaveLength(1);
    expect(await f.read("ignored.txt")).toBe("mine\n");
  });
  it("restores an ignored file when its structured edit supplied immediate before contents", async () => {
    const f = await fixture();
    await f.write(".gitignore", "ignored.txt\n");
    await f.write("ignored.txt", "existing\n");
    await f.checkpoints.beginFilesTurn("s", f.cwd, "one");
    await f.checkpoints.prepareFilesTurn("s", f.cwd, "one", ["ignored.txt"]);
    await f.write("ignored.txt", "mine\n");
    await f.checkpoints.claim("s", f.cwd, "one", ["ignored.txt"]);
    await f.checkpoints.finishFilesTurn("s", f.cwd, "one");
    expect((await f.checkpoints.filesRevert("s", f.cwd, "one")).reverted).toEqual(["ignored.txt"]);
    expect(await f.read("ignored.txt")).toBe("existing\n");
  });
  it("restores turn-one state and removes turn-two creations after multiple turns and restart", async () => {
    const f = await fixture();
    await f.turn("one", () => f.write("a.txt", "one\n"));
    await f.turn("two", async () => {
      await f.write("a.txt", "two\n");
      await f.write("created.txt", "created\n");
    });
    await f.turn("three", () => f.write("a.txt", "three\n"));
    const restarted = new HostCheckpoints(join(f.root, "checkpoints"));
    expect(await restarted.filesRevertPlan("s", f.cwd, "two")).toEqual({
      files: [
        { path: "a.txt", action: "restore", conflict: undefined },
        { path: "created.txt", action: "delete", conflict: undefined },
      ],
    });
    expect(await restarted.filesRevert("s", f.cwd, "two")).toEqual({
      reverted: ["a.txt", "created.txt"],
      skipped: [],
    });
    expect(await f.read("a.txt")).toBe("one\n");
    const review = await restarted.status("s", f.cwd);
    expect(review.files).toHaveLength(1);
    expect(review.files[0].undoable).toBe(true);
    await expect(f.read("created.txt")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await f.git("for-each-ref", "refs/bycoda/checkpoints")).toBe("");
    expect(await readdir(f.cwd)).not.toContainEqual(expect.stringContaining(".bycoda-"));
  });
  it("rechecks current contents after planning and preserves another session's edit", async () => {
    const f = await fixture();
    await f.turn("one", () => f.write("a.txt", "mine\n"));
    expect(
      (await f.checkpoints.filesRevertPlan("s", f.cwd, "one")).files[0].conflict,
    ).toBeUndefined();
    await f.write("a.txt", "other session\n");
    const result = await f.checkpoints.filesRevert("s", f.cwd, "one");
    expect(result.reverted).toEqual([]);
    expect(result.skipped).toEqual([
      { path: "a.txt", reason: "File changed outside this session" },
    ]);
    expect(await f.read("a.txt")).toBe("other session\n");
  });
  it("detects external edits between two of this session's turns", async () => {
    const f = await fixture();
    await f.turn("one", () => f.write("a.txt", "one\n"));
    await f.write("a.txt", "external\n");
    await f.turn("two", () => f.write("a.txt", "two\n"));
    expect((await f.checkpoints.filesRevertPlan("s", f.cwd, "one")).files[0].conflict).toMatch(
      /between turns/,
    );
    expect((await f.checkpoints.filesRevert("s", f.cwd, "one")).reverted).toEqual([]);
    expect(await f.read("a.txt")).toBe("two\n");
  });
  it("prunes oldest history while preserving recent turns", async () => {
    const f = await fixture();
    const history = new SessionFileRevert(join(f.root, "history"), 1800);
    for (const id of ["one", "two", "three"]) {
      await history.begin("s", f.cwd, id);
      await f.write("a.txt", id.repeat(110));
      await history.finish("s", f.cwd, id);
    }
    expect((await history.plan("s", f.cwd, "one")).unavailable).toMatch(/pruned/);
    expect((await history.plan("s", f.cwd, "three")).unavailable).toBeUndefined();
    expect((await history.revert("s", f.cwd, "three")).reverted).toEqual(["a.txt"]);
    expect(await f.read("a.txt")).toBe("two".repeat(110));
  });
  it("restores a linked worktree as uncommitted changes without changing commits or index", async () => {
    const f = await fixture();
    const worktree = join(f.root, "worktree");
    await f.git("worktree", "add", "-qb", "session", worktree);
    const git = async (...args: string[]) =>
      (
        await execFileAsync("git", args, { cwd: worktree, windowsHide: true, encoding: "utf8" })
      ).stdout.trim();
    await f.checkpoints.beginFilesTurn("s", worktree, "run", "message");
    await writeFile(join(worktree, "a.txt"), "committed session\n");
    await f.checkpoints.finishFilesTurn("s", worktree, "run");
    await git("add", ".");
    await git("commit", "-qm", "session change");
    const head = await git("rev-parse", "HEAD");
    expect((await f.checkpoints.filesRevert("s", worktree, "message")).reverted).toEqual(["a.txt"]);
    expect(await git("rev-parse", "HEAD")).toBe(head);
    expect(await git("diff", "--cached")).toBe("");
    expect(await git("status", "--porcelain")).toMatch(/M a.txt/);
    expect(await readFile(join(worktree, "a.txt"), "utf8")).toBe("base\n");
    expect(await f.read("a.txt")).toBe("base\n");
  });
  it("captures only attributed files when sessions overlap", async () => {
    const f = await fixture();
    await f.checkpoints.beginFilesTurn("s", f.cwd, "one");
    await f.checkpoints.beginFilesTurn("other", f.cwd, "two");
    await f.checkpoints.prepareFilesTurn("s", f.cwd, "one", ["a.txt"]);
    await f.write("a.txt", "mine\n");
    await f.checkpoints.claim("s", f.cwd, "one", ["a.txt"]);
    await f.write("peer.txt", "peer\n");
    await f.checkpoints.finishFilesTurn("other", f.cwd, "two");
    await f.checkpoints.finishFilesTurn("s", f.cwd, "one");
    expect(
      (await f.checkpoints.filesRevertPlan("s", f.cwd, "one")).files.map((f) => f.path),
    ).toEqual(["a.txt"]);
    await f.checkpoints.filesRevert("s", f.cwd, "one");
    expect(await f.read("peer.txt")).toBe("peer\n");
  });
  it("keeps a peer edit made after an attributed tool completes", async () => {
    const f = await fixture();
    await f.checkpoints.beginFilesTurn("s", f.cwd, "one");
    await f.checkpoints.beginFilesTurn("other", f.cwd, "two");
    await f.write("a.txt", "mine\n");
    await f.checkpoints.claim("s", f.cwd, "one", ["a.txt"]);
    await f.write("a.txt", "peer\n");
    await f.checkpoints.finishFilesTurn("s", f.cwd, "one");
    await f.checkpoints.finishFilesTurn("other", f.cwd, "two");
    expect((await f.checkpoints.filesRevert("s", f.cwd, "one")).skipped[0].reason).toMatch(
      /overlapping|outside/,
    );
    expect(await f.read("a.txt")).toBe("peer\n");
  });
  it("supports plain folders and restores deleted files", async () => {
    const f = await fixture(false);
    await f.turn("one", () => rm(join(f.cwd, "a.txt")));
    await f.checkpoints.filesRevert("s", f.cwd, "one");
    expect(await f.read("a.txt")).toBe("base\n");
  });
  it("never restores a turn-start baseline over a peer's earlier contribution", async () => {
    const f = await fixture();
    await f.checkpoints.beginFilesTurn("s", f.cwd, "one");
    await f.checkpoints.beginFilesTurn("other", f.cwd, "two");
    await f.write("a.txt", "peer contribution\n");
    await f.write("a.txt", "peer contribution plus mine\n");
    await f.checkpoints.claim("s", f.cwd, "one", ["a.txt"]);
    await f.checkpoints.finishFilesTurn("s", f.cwd, "one");
    await f.checkpoints.finishFilesTurn("other", f.cwd, "two");
    const result = await f.checkpoints.filesRevert("s", f.cwd, "one");
    expect(result.reverted).toEqual([]);
    expect(result.skipped[0].reason).toMatch(/Pre-edit/);
    expect(await f.read("a.txt")).toBe("peer contribution plus mine\n");
  });
  it("uses immediate structured-edit before contents when a shared path can be attributed", async () => {
    const f = await fixture();
    await f.checkpoints.beginFilesTurn("s", f.cwd, "one");
    await f.checkpoints.beginFilesTurn("other", f.cwd, "two");
    await f.write("a.txt", "peer contribution\n");
    await f.checkpoints.prepareFilesTurn("s", f.cwd, "one", ["a.txt"]);
    await f.write("a.txt", "peer contribution plus mine\n");
    await f.checkpoints.claim("s", f.cwd, "one", ["a.txt"]);
    await f.checkpoints.finishFilesTurn("s", f.cwd, "one");
    await f.checkpoints.finishFilesTurn("other", f.cwd, "two");
    expect((await f.checkpoints.filesRevert("s", f.cwd, "one")).reverted).toEqual(["a.txt"]);
    expect(await f.read("a.txt")).toBe("peer contribution\n");
  });
  it("does not let unrelated oversized files disable captured history", async () => {
    const f = await fixture();
    await f.write("large.bin", "x".repeat(8 * 1024 * 1024 + 1));
    await f.turn("one", () => f.write("a.txt", "mine\n"));
    expect((await f.checkpoints.filesRevertPlan("s", f.cwd, "one")).unavailable).toBeUndefined();
    expect((await f.checkpoints.filesRevert("s", f.cwd, "one")).reverted).toEqual(["a.txt"]);
  });
  it.runIf(process.platform === "win32")(
    "skips a file with an existing writable handle",
    async () => {
      const f = await fixture();
      await f.turn("one", () => f.write("a.txt", "mine\n"));
      const writer = await open(join(f.cwd, "a.txt"), "r+");
      try {
        const result = await f.checkpoints.filesRevert("s", f.cwd, "one");
        expect(result.reverted).toEqual([]);
        expect(result.skipped[0].reason).toMatch(/open for writing/);
        expect(await f.read("a.txt")).toBe("mine\n");
      } finally {
        await writer.close();
      }
      expect((await f.checkpoints.filesRevert("s", f.cwd, "one")).reverted).toEqual(["a.txt"]);
    },
  );
  it("preserves an external write made after a completed edit without a second turn", async () => {
    const f = await fixture();
    await f.checkpoints.beginFilesTurn("s", f.cwd, "one");
    await f.write("a.txt", "mine\n");
    await f.checkpoints.claim("s", f.cwd, "one", ["a.txt"]);
    await f.write("a.txt", "external\n");
    await f.checkpoints.finishFilesTurn("s", f.cwd, "one");
    expect((await f.checkpoints.filesRevert("s", f.cwd, "one")).skipped).toHaveLength(1);
    expect(await f.read("a.txt")).toBe("external\n");
  });
  it("detects a peer's edits between attributed writes in the same turn", async () => {
    const f = await fixture();
    await f.checkpoints.beginFilesTurn("s", f.cwd, "one");
    await f.checkpoints.prepareFilesTurn("s", f.cwd, "one", ["a.txt"]);
    await f.write("a.txt", "mine\n");
    await f.checkpoints.claim("s", f.cwd, "one", ["a.txt"]);
    await f.write("a.txt", "external\n");
    await f.checkpoints.prepareFilesTurn("s", f.cwd, "one", ["a.txt"]);
    await f.write("a.txt", "mine plus external\n");
    await f.checkpoints.claim("s", f.cwd, "one", ["a.txt"]);
    await f.checkpoints.finishFilesTurn("s", f.cwd, "one");
    expect((await f.checkpoints.filesRevert("s", f.cwd, "one")).skipped[0].reason).toMatch(
      /between edits/,
    );
    expect(await f.read("a.txt")).toBe("mine plus external\n");
  });
  it("rejects attribution to Git metadata and paths outside the checkout", async () => {
    const f = await fixture();
    const head = await f.git("rev-parse", "HEAD");
    await f.checkpoints.beginFilesTurn("s", f.cwd, "one");
    for (const path of [".git/HEAD", "../outside.txt", ".git./HEAD"]) {
      await expect(f.checkpoints.claim("s", f.cwd, "one", [path])).rejects.toThrow();
    }
    await f.checkpoints.finishFilesTurn("s", f.cwd, "one");
    expect(await f.git("rev-parse", "HEAD")).toBe(head);
  });
  it("retires removed conversation turns without touching files", async () => {
    const f = await fixture();
    await f.turn("one", () => f.write("a.txt", "one\n"));
    await f.turn("two", () => f.write("a.txt", "two\n"));
    await f.checkpoints.forgetFilesFromMessage("s", f.cwd, "two");
    expect(await f.read("a.txt")).toBe("two\n");
    expect((await f.checkpoints.filesRevertPlan("s", f.cwd, "two")).unavailable).toMatch(
      /unavailable/,
    );
    expect((await f.checkpoints.filesRevertPlan("s", f.cwd, "one")).files[0].conflict).toMatch(
      /outside/,
    );
    await f.turn("three", () => f.write("a.txt", "three\n"));
    await f.checkpoints.filesRevert("s", f.cwd, "three");
    expect(await f.read("a.txt")).toBe("two\n");
  });
  it("reports interrupted history unavailable after process restart", async () => {
    const f = await fixture();
    await f.checkpoints.beginFilesTurn("s", f.cwd, "one");
    await f.write("a.txt", "partial\n");
    const restarted = new HostCheckpoints(join(f.root, "checkpoints"));
    expect((await restarted.filesRevertPlan("s", f.cwd, "one")).unavailable).toMatch(/interrupted/);
    await expect(restarted.filesRevert("s", f.cwd, "one")).rejects.toThrow(/interrupted/);
    expect(await f.read("a.txt")).toBe("partial\n");
    await expect(restarted.beginFilesTurn("s", f.cwd, "one")).rejects.toThrow(/already recorded/);
    expect((await restarted.filesRevertPlan("s", f.cwd, "one")).unavailable).toMatch(/interrupted/);
  });
  it("rejects linked parents introduced after capture without changing their target", async () => {
    const f = await fixture();
    await mkdir(join(f.cwd, "dir"));
    await f.write("dir/a.txt", "before\n");
    await f.turn("one", () => f.write("dir/a.txt", "mine\n"));
    const outside = join(f.root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "a.txt"), "mine\n");
    await rm(join(f.cwd, "dir"), { recursive: true });
    await symlink(outside, join(f.cwd, "dir"), "junction");
    const result = await f.checkpoints.filesRevert("s", f.cwd, "one");
    expect(result.reverted).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(await readFile(join(outside, "a.txt"), "utf8")).toBe("mine\n");
  });
});
