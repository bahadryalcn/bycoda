import { execFileAsync as exec } from "../../src/shared/lib/processExecution.node";
import { mkdtemp, mkdir, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostCheckpoints } from "./checkpoints";

const roots: string[] = [];
if (process.platform === "win32") vi.setConfig({ testTimeout: 60_000 });
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
});
async function fixture() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "bycoda-forget-")));
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
  await git("add", "--", "a.txt");
  await git("commit", "-qm", "base");
  const root = join(dir, "checkpoints");
  return { dir, cwd, git, root, checkpoints: new HostCheckpoints(root, undefined, async () => {}) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const refs = async (f: Fixture, session: string) =>
  (await f.git("for-each-ref", "--format=%(refname)", `refs/bycoda/checkpoints/${session}/`)).stdout
    .split("\n")
    .filter(Boolean);
async function turn(f: Fixture, session: string, id: string, content: string) {
  await f.checkpoints.begin(session, f.cwd, id);
  await writeFile(join(f.cwd, "a.txt"), content);
  await f.checkpoints.finish(session, f.cwd, id);
}

describe("deleted session checkpoint cleanup", () => {
  it("deletes only the deleted session's refs and manifest", async () => {
    const f = await fixture();
    await turn(f, "gone", "one", "gone\n");
    await turn(f, "kept", "one", "kept\n");
    expect((await refs(f, "gone")).length).toBeGreaterThan(0);
    await f.checkpoints.retireDeletedSessionHistory("gone", f.cwd);
    expect(await refs(f, "gone")).toEqual([]);
    expect((await refs(f, "kept")).length).toBeGreaterThan(0);
    await expect(stat(join(f.root, "gone", "manifest.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await stat(join(f.root, "kept", "manifest.json"));
  });

  it("refuses to forget a session whose turn is still active", async () => {
    const f = await fixture();
    await turn(f, "live", "one", "one\n");
    await f.checkpoints.begin("live", f.cwd, "two");
    const before = await refs(f, "live");
    await expect(f.checkpoints.retireDeletedSessionHistory("live", f.cwd)).rejects.toThrow();
    expect(await refs(f, "live")).toEqual(before);
    await stat(join(f.root, "live", "manifest.json"));
  });

  it("forgets a session whose checkout was removed without failing", async () => {
    const f = await fixture();
    await turn(f, "orphan", "one", "one\n");
    await rm(f.cwd, { recursive: true, force: true, maxRetries: 5 });
    await f.checkpoints.retireDeletedSessionHistory("orphan", f.cwd);
    expect(await readdir(join(f.root, "orphan")).catch(() => [])).not.toContain("manifest.json");
  });

  it("drops earlier turns' refs in one batch and keeps the latest turn's", async () => {
    const f = await fixture();
    await turn(f, "many", "one", "one\n");
    await turn(f, "many", "two", "two\n");
    await turn(f, "many", "three", "three\n");
    const names = await refs(f, "many");
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => name.startsWith("refs/bycoda/checkpoints/many/three/"))).toBe(
      true,
    );
  });

  it("retires committed paths together while preserving pending paths", async () => {
    const f = await fixture();
    await f.checkpoints.begin("mixed", f.cwd, "one");
    await writeFile(join(f.cwd, "a.txt"), "committed\n");
    await writeFile(join(f.cwd, "[literal].txt"), "committed\n");
    await writeFile(join(f.cwd, "pending.txt"), "pending\n");
    await f.checkpoints.finish("mixed", f.cwd, "one");
    expect((await f.checkpoints.status("mixed", f.cwd)).files).toHaveLength(3);

    await f.git("--literal-pathspecs", "add", "--", "a.txt", "[literal].txt");
    await f.git("commit", "-qm", "commit two checkpoint paths");

    const status = await f.checkpoints.status("mixed", f.cwd);
    expect(status.files.map((file) => file.relative)).toEqual(["pending.txt"]);
  });
});
