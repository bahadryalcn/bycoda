import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileAsync as exec } from "../../src/shared/lib/processExecution.node";
import { HostCheckpoints } from "./checkpoints";

// Every file this process reads; Git reading the checkout runs in its own process.
const reads: string[] = [];
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: (path: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
      reads.push(String(path).replace(/\\/g, "/"));
      return (actual.readFile as (...args: unknown[]) => unknown)(path, ...rest);
    },
  };
});

if (process.platform === "win32") vi.setConfig({ testTimeout: 120_000 });
else vi.setConfig({ testTimeout: 60_000 });
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

// CI macOS: the Host's own host.db was inside the session's workspace. Turn history read and
// closed host.db-shm in the Host process, which drops every POSIX lock SQLite holds on it; the
// session-read child then rebuilt the WAL index under a live mapping (SIGBUS in walIndexReadHdr).
const HOST_FILES = ["host.db", "host.db-wal", "host.db-shm", "attachments/blob"];
async function fixture(gitRepo: boolean) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "bycoda-host-storage-")));
  roots.push(dir);
  const cwd = dir;
  const git = (...args: string[]) =>
    exec("git", args, { cwd, encoding: "utf8", windowsHide: true });
  await writeFile(join(cwd, "a.txt"), "base\n");
  if (gitRepo) {
    await git("init", "-q");
    await git("config", "user.email", "test@example.invalid");
    await git("config", "user.name", "Test");
    await git("config", "core.autocrlf", "false");
    await git("add", "--", "a.txt");
    await git("commit", "-qm", "base");
  }
  await mkdir(join(cwd, "attachments"));
  for (const name of [...HOST_FILES, "data.db"]) await writeFile(join(cwd, name), `${name} 1\n`);
  const db = join(cwd, "host.db");
  const owned = [db, `${db}-wal`, `${db}-shm`, `${db}-journal`, join(cwd, "attachments")];
  const checkpoints = (hostOwned = owned) =>
    new HostCheckpoints(join(cwd, "checkpoints"), undefined, async () => {}, hostOwned);
  return {
    cwd,
    checkpoints,
    write: (names: string[], text: string) =>
      Promise.all(names.map((name) => writeFile(join(cwd, name), `${name} ${text}\n`))),
    read: (name: string) => fs.readFile(join(cwd, name), "utf8"),
  };
}
const hostReads = (cwd: string) =>
  reads.filter((path) => HOST_FILES.some((name) => path === `${cwd.replace(/\\/g, "/")}/${name}`));

describe("Host storage inside a session workspace", () => {
  it.each([false, true])(
    "turn file history never reads it, even when a provider names it (git: %s)",
    async (gitRepo) => {
      const f = await fixture(gitRepo);
      const checkpoints = f.checkpoints();
      reads.length = 0;
      await checkpoints.beginFilesTurn("s", f.cwd, "run-one", "one");
      await checkpoints.prepareFilesTurn("s", f.cwd, "run-one", ["host.db-shm", "data.db"]);
      await f.write([...HOST_FILES, "data.db"], "2");
      await checkpoints.claimFilesProof("s", f.cwd, "run-one", "call", [
        { path: "host.db-shm", kind: "update", contents: "host.db-shm 2\n" },
      ]);
      await checkpoints.finishFilesTurn("s", f.cwd, "run-one");
      const plan = await checkpoints.filesRevertPlan("s", f.cwd, "one");
      expect(plan.files.map((file) => file.path)).toEqual(["data.db"]);
      await checkpoints.filesRevert("s", f.cwd, "one");
      expect(hostReads(f.cwd)).toEqual([]);
      expect(await f.read("data.db")).toBe("data.db 1\n");
      for (const name of HOST_FILES) expect(await f.read(name)).toBe(`${name} 2\n`);
    },
  );

  it("Git checkpoints never read or restore it", async () => {
    const f = await fixture(true);
    const checkpoints = f.checkpoints();
    reads.length = 0;
    await checkpoints.begin("s", f.cwd, "turn");
    await f.write([...HOST_FILES, "data.db"], "2");
    await checkpoints.claim("s", f.cwd, "turn", ["host.db-shm", "data.db"]);
    await checkpoints.finish("s", f.cwd, "turn");
    const status = await checkpoints.status("s", f.cwd);
    expect(status.files.map((file) => file.relative).sort()).toEqual(["data.db"]);
    await checkpoints.change("s", f.cwd, undefined, true);
    expect(hostReads(f.cwd)).toEqual([]);
    expect(await f.read("data.db")).toBe("data.db 1\n");
    for (const name of HOST_FILES) expect(await f.read(name)).toBe(`${name} 2\n`);
  });

  it("keeps it out of the private Git trees while ordinary files stay in them", async () => {
    const f = await fixture(true);
    const checkpoints = f.checkpoints();
    await checkpoints.begin("s", f.cwd, "turn");
    await f.write([...HOST_FILES, "data.db"], "2");
    await checkpoints.claim("s", f.cwd, "turn", ["data.db"]);
    await checkpoints.finish("s", f.cwd, "turn");
    const refs = (
      await exec("git", ["for-each-ref", "--format=%(refname)", "refs/bycoda/checkpoints/s/"], {
        cwd: f.cwd,
        encoding: "utf8",
        windowsHide: true,
      })
    ).stdout
      .split("\n")
      .filter(Boolean);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const tree = (
        await exec("git", ["ls-tree", "-r", "--name-only", ref], {
          cwd: f.cwd,
          encoding: "utf8",
          windowsHide: true,
        })
      ).stdout
        .split("\n")
        .filter(Boolean);
      expect(tree).toContain("data.db");
      expect(tree.filter((path) => /^(host\.db|attachments\/|checkpoints\/)/.test(path))).toEqual(
        [],
      );
    }
  });

  it("history recorded before the exclusion is never read back or applied to it", async () => {
    const f = await fixture(true);
    // Recorded by a build that captured Host storage like any other file.
    const legacy = f.checkpoints([]);
    await legacy.beginFilesTurn("s", f.cwd, "run-one", "one");
    await f.write(["host.db-shm", "data.db"], "2");
    await legacy.finishFilesTurn("s", f.cwd, "run-one");
    await legacy.begin("g", f.cwd, "turn");
    await f.write(["host.db-shm", "data.db"], "3");
    await legacy.claim("g", f.cwd, "turn", ["host.db-shm"]);
    await legacy.finish("g", f.cwd, "turn");
    expect((await legacy.status("g", f.cwd)).files.map((file) => file.relative)).toEqual([
      "host.db-shm",
    ]);
    const checkpoints = f.checkpoints();
    reads.length = 0;
    const plan = await checkpoints.filesRevertPlan("s", f.cwd, "one");
    expect(plan.files.find((file) => file.path === "host.db-shm")?.conflict).toBe(
      "Host storage is never reverted",
    );
    const result = await checkpoints.filesRevert("s", f.cwd, "one");
    expect(result.skipped.map((file) => file.path)).toContain("host.db-shm");
    await checkpoints.change("g", f.cwd, "host.db-shm", true);
    expect(hostReads(f.cwd)).toEqual([]);
    expect(await f.read("host.db-shm")).toBe("host.db-shm 3\n");
  });
});
