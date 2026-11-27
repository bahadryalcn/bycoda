import { execFileAsync as exec } from "../../src/shared/lib/processExecution.node";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostCheckpoints } from "./checkpoints";

const roots: string[] = [];
// Thousands of files go through real Git trees; Windows needs the longer deadline.
if (process.platform === "win32") vi.setConfig({ testTimeout: 120_000 });
else vi.setConfig({ testTimeout: 60_000 });
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
});
async function fixture() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "bycoda-limits-")));
  roots.push(dir);
  const cwd = join(dir, "repo");
  await mkdir(cwd);
  const git = (...args: string[]) =>
    exec("git", args, { cwd, encoding: "utf8", windowsHide: true });
  await git("init", "-q");
  await git("config", "user.email", "test@example.invalid");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");
  await writeFile(join(cwd, "a.txt"), "base\n");
  await writeFile(join(cwd, "b.txt"), "keep\n");
  await git("add", "--", "a.txt", "b.txt");
  await git("commit", "-qm", "base");
  return {
    dir,
    cwd,
    git,
    checkpoints: new HostCheckpoints(join(dir, "checkpoints"), undefined, async () => {}),
  };
}
async function writeMany(folder: string, count: number) {
  await mkdir(folder, { recursive: true });
  for (let offset = 0; offset < count; offset += 100)
    await Promise.all(
      Array.from({ length: Math.min(100, count - offset) }, (_, i) =>
        writeFile(join(folder, `f${String(offset + i).padStart(5, "0")}.txt`), "x\n"),
      ),
    );
}

describe("checkpoint bounds in large repositories", () => {
  it("keeps recording when more than 2,000 files were already dirty and refuses only what it cannot restore", async () => {
    const f = await fixture();
    await writeMany(join(f.cwd, "junk"), 2100);
    // The old baseline threw "Too many dirty files for checkpoint" here.
    await f.checkpoints.begin("session", f.cwd, "turn");
    await writeFile(join(f.cwd, "b.txt"), "agent\n");
    await writeFile(join(f.cwd, "new.txt"), "new\n");
    // Sorted untracked paths past the 2,000th have no exact baseline bytes.
    await writeFile(join(f.cwd, "junk", "f02050.txt"), "agent\n");
    await f.checkpoints.finish("session", f.cwd, "turn");

    const status = await f.checkpoints.status("session", f.cwd);
    const byPath = Object.fromEntries(status.files.map((file) => [file.relative, file]));
    expect(Object.keys(byPath).sort()).toEqual(["b.txt", "junk/f02050.txt", "new.txt"]);
    expect(byPath["b.txt"].undoable).toBe(true);
    expect(byPath["new.txt"].undoable).toBe(true);
    expect(byPath["junk/f02050.txt"]).toMatchObject({ exact: false, undoable: false });
    await expect(f.checkpoints.fileDiff("session", f.cwd, "junk/f02050.txt")).rejects.toThrow(
      "more than 2000 files were already modified",
    );
    // A bulk undo includes the uncaptured file, so it is rejected before any write.
    await expect(f.checkpoints.change("session", f.cwd, undefined, true)).rejects.toThrow(
      "its original bytes were not recorded because more than 2000 files",
    );
    expect(await readFile(join(f.cwd, "b.txt"), "utf8")).toBe("agent\n");
    // Files with recorded or clean baselines still undo one at a time.
    await f.checkpoints.change("session", f.cwd, "b.txt", true);
    expect(await readFile(join(f.cwd, "b.txt"), "utf8")).toBe("keep\n");
    await f.checkpoints.change("session", f.cwd, "new.txt", true);
    await expect(readFile(join(f.cwd, "new.txt"))).rejects.toThrow();
    // The uncaptured file was never rewritten.
    expect(await readFile(join(f.cwd, "junk", "f02050.txt"), "utf8")).toBe("agent\n");
  });

  it("lists a file over the per-file bound without failing the checkpoint or its status", async () => {
    const f = await fixture();
    const big = join(f.cwd, "big.bin");
    await writeFile(big, Buffer.alloc(9 * 1024 * 1024, "a"));
    await f.git("add", "--", "big.bin");
    await f.git("commit", "-qm", "big");
    await f.checkpoints.begin("session", f.cwd, "turn");
    await writeFile(big, Buffer.alloc(9 * 1024 * 1024 + 1, "a"));
    await writeFile(join(f.cwd, "a.txt"), "agent\n");
    // Used to throw "Checkpoint file is too large" and fail the whole record.
    await f.checkpoints.finish("session", f.cwd, "turn");

    const status = await f.checkpoints.status("session", f.cwd);
    const byPath = Object.fromEntries(status.files.map((file) => [file.relative, file]));
    expect(Object.keys(byPath).sort()).toEqual(["a.txt", "big.bin"]);
    expect(byPath["a.txt"].undoable).toBe(true);
    expect(byPath["big.bin"]).toMatchObject({ exact: false, undoable: false, additions: 0 });
    await expect(f.checkpoints.change("session", f.cwd, "big.bin", true)).rejects.toThrow(
      "exceed the 8 MB checkpoint limit",
    );
    await f.checkpoints.change("session", f.cwd, "a.txt", true);
    expect(await readFile(join(f.cwd, "a.txt"), "utf8")).toBe("base\n");
  });

  it("does not carry a partial delta forward when a turn exceeds the changed-file limit", async () => {
    const f = await fixture();
    await f.checkpoints.begin("session", f.cwd, "one");
    await writeFile(join(f.cwd, "a.txt"), "agent\n");
    await f.checkpoints.finish("session", f.cwd, "one");

    await f.checkpoints.begin("session", f.cwd, "two");
    await writeFile(join(f.cwd, "b.txt"), "agent\n");
    await writeMany(join(f.cwd, "gen"), 2100);
    await expect(f.checkpoints.finish("session", f.cwd, "two")).rejects.toThrow(
      /Too many changed files for checkpoint: \d+ files changed in one turn, the limit is 2000/,
    );
    await expect(f.checkpoints.status("session", f.cwd)).rejects.toThrow(
      "Workspace checkpoint failed",
    );

    await f.checkpoints.begin("session", f.cwd, "three");
    await f.checkpoints.finish("session", f.cwd, "three");
    // Only the earlier complete delta remains, and it no longer reads as the whole checkpoint.
    const status = await f.checkpoints.status("session", f.cwd);
    expect(status.files.map((file) => file.relative)).toEqual(["a.txt"]);
    expect(status.files[0]).toMatchObject({ exact: false, undoable: false });
    await expect(f.checkpoints.change("session", f.cwd, "a.txt", true)).rejects.toThrow(
      "an earlier turn's checkpoint failed",
    );
    expect(await readFile(join(f.cwd, "a.txt"), "utf8")).toBe("agent\n");
  });
});
