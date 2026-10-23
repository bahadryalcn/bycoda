import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostCheckpoints } from "./checkpoints";

// Checkpoint snapshots add refs to the user's repository. Every ref change
// wakes git watchers and every ref is another file for Git to scan, so the
// number of refs must not grow without bound over a long-lived session.

const roots: string[] = [];
if (process.platform === "win32") vi.setConfig({ testTimeout: 90_000 });
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

async function fixture() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "bycoda-turn-perf-")));
  roots.push(dir);
  const cwd = join(dir, "repo");
  await mkdir(cwd);
  const git = async (...args: string[]) =>
    String((await exec("git", args, { cwd, encoding: "utf8", windowsHide: true })).stdout);
  await git("init", "-q");
  await git("config", "user.email", "test@example.invalid");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");
  await writeFile(join(cwd, "a.txt"), "base\n");
  await git("add", "--", "a.txt");
  await git("commit", "-qm", "base");
  return { cwd, git, checkpoints: new HostCheckpoints(join(dir, "checkpoints")) };
}

describe("host checkpoint refs (perf)", () => {
  // perf P8: checkpoint refs must be pruned/capped per session instead of a before/after pair per turn forever; remove .fails when fixed.
  it.fails("does not keep a before/after ref pair for every turn of a session", async () => {
    const f = await fixture();
    const turns = 6;
    for (let i = 1; i <= turns; i++) {
      await f.checkpoints.begin("session", f.cwd, `turn-${i}`);
      await writeFile(join(f.cwd, "a.txt"), `edit ${i}\n`);
      await f.checkpoints.finish("session", f.cwd, `turn-${i}`);
    }
    // Precondition: the session's review still works.
    expect((await f.checkpoints.status("session", f.cwd)).files.map((x) => x.relative)).toEqual([
      "a.txt",
    ]);
    const refs = (await f.git("for-each-ref", "--format=%(refname)", "refs/bycoda"))
      .split("\n")
      .filter(Boolean);
    expect(refs.length).toBeLessThan(turns * 2);
  });
});
