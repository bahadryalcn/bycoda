import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  active: 0,
  peak: 0,
  args: [] as { args: string[]; options: Record<string, unknown> }[],
}));
vi.mock("../git/git-exec-pool", async (importOriginal) => {
  const original = await importOriginal<typeof import("../git/git-exec-pool")>();
  return {
    ...original,
    hostGitExec: {
      exec: async (file: string, args: string[], options: Record<string, unknown>) => {
        calls.args.push({ args, options });
        calls.active++;
        calls.peak = Math.max(calls.peak, calls.active);
        try {
          return await original.hostGitExec.exec(file, args, options as never);
        } finally {
          calls.active--;
        }
      },
    },
  };
});
const { execFileAsync: exec } = await import("../../src/shared/lib/processExecution.node");
const { HostCheckpoints } = await import("./checkpoints");

const roots: string[] = [];
if (process.platform === "win32") vi.setConfig({ testTimeout: 60_000 });
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

it("bounds git processes for checkpoint status and gives numstat a deadline", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "bycoda-checkpoint-bound-")));
  roots.push(dir);
  const cwd = join(dir, "repo");
  await mkdir(cwd);
  const git = (...args: string[]) =>
    exec("git", args, { cwd, encoding: "utf8", windowsHide: true });
  await git("init", "-q");
  await git("config", "user.email", "test@example.invalid");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");
  const names = Array.from({ length: 24 }, (_, index) => `file-${index}.txt`);
  for (const name of names) await writeFile(join(cwd, name), "base\n");
  await git("add", "--", ...names);
  await git("commit", "-qm", "base");
  const checkpoints = new HostCheckpoints(join(dir, "checkpoints"), undefined, async () => {});
  await checkpoints.begin("session", cwd, "one");
  for (const name of names) await writeFile(join(cwd, name), "base\nchanged\n");
  await checkpoints.finish("session", cwd, "one");

  calls.peak = 0;
  calls.args = [];
  const status = await checkpoints.status("session", cwd);
  expect(status.files).toHaveLength(names.length);
  expect(status.files.map((file) => file.relative).sort()).toEqual([...names].sort());
  expect(status.files.every((file) => file.additions === 1 && file.deletions === 0)).toBe(true);
  // Four files at a time, each with at most both sides reading in parallel.
  expect(calls.peak).toBeLessThanOrEqual(8);
  const prefixes = calls.args.filter(({ args }) => args.includes("--show-prefix"));
  expect(prefixes.length).toBeLessThanOrEqual(1);
  const numstat = calls.args.filter(({ args }) => args.includes("--numstat"));
  expect(numstat).toHaveLength(names.length);
  expect(numstat.every(({ options }) => typeof options.timeout === "number")).toBe(true);
});
