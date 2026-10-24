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
  it("preserves promise rejection for invalid IDs on queued operations", async () => {
    const checkpoints = new HostCheckpoints("unused-checkpoint-test-root");
    for (const call of [
      () => checkpoints.status("../escape", "/unused"),
      () => checkpoints.finish("../escape", "/unused", "turn"),
      () => checkpoints.claim("../escape", "/unused", "turn", []),
    ]) {
      let result: Promise<unknown> | undefined;
      expect(() => {
        result = call();
      }).not.toThrow();
      await expect(result).rejects.toThrow("Invalid checkpoint ID");
    }
  });

  it("does not hold an independent checkout behind a slow capture, while nested paths wait", async () => {
    const a = await fixture();
    const b = await fixture();
    const nested = join(a.cwd, "nested");
    await mkdir(nested);
    const target = a.checkpoints as unknown as { snapshot: (...args: string[]) => Promise<string> };
    const snapshot = target.snapshot.bind(target);
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const spy = vi.spyOn(target, "snapshot").mockImplementation(async (...args) => {
      if (args[0] === a.cwd) {
        entered();
        await held;
      }
      return snapshot(...args);
    });
    const first = a.checkpoints.begin("slow", a.cwd, "one");
    await started;
    const independent = a.checkpoints.begin("independent", b.cwd, "one");
    const overlapping = a.checkpoints.begin("nested", nested, "one");
    let overlapDone = false;
    void overlapping.then(() => {
      overlapDone = true;
    });
    let progressed: boolean;
    try {
      progressed = await Promise.race([
        independent.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
      ]);
      expect(overlapDone).toBe(false);
    } finally {
      release();
      await Promise.all([first, independent, overlapping]);
      spy.mockRestore();
    }
    expect(progressed!).toBe(true);
  });

  it.each([10, 1000, 10_000])(
    "does not reopen %i historical manifests on a warm status read",
    async (count) => {
      const f = await fixture();
      const root = (f.checkpoints as unknown as { root: string }).root;
      const historical = JSON.stringify({ cwd: f.cwd, head: null, shared: false, files: {} });
      for (let offset = 0; offset < count; offset += 64)
        await Promise.all(
          Array.from({ length: Math.min(64, count - offset) }, async (_, i) => {
            const dir = join(root, `historical-${offset + i}`);
            await mkdir(dir, { recursive: true });
            await writeFile(join(dir, "manifest.json"), historical);
          }),
        );
      await f.checkpoints.begin("current", f.cwd, "one");
      await writeFile(join(f.cwd, "a.txt"), "agent\n");
      await f.checkpoints.finish("current", f.cwd, "one");
      const target = f.checkpoints as unknown as { load: (session: string) => Promise<unknown> };
      const spy = vi.spyOn(target, "load");
      const status = await f.checkpoints.status("current", f.cwd);
      const openedHistory = spy.mock.calls.filter(([session]) =>
        session.startsWith("historical-"),
      ).length;
      console.info(
        JSON.stringify({
          checkpointHistoricalCount: count,
          warmHistoricalManifestReads: openedHistory,
        }),
      );
      expect(status.files[0].undoable).toBe(true);
      expect(openedHistory).toBe(0);
      spy.mockRestore();
    },
  );

  // perf P8: checkpoint refs must be pruned/capped per session instead of a before/after pair per turn forever.
  it("does not keep a before/after ref pair for every turn of a session", async () => {
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
