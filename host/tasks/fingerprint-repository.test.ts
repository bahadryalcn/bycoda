import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import type { TaskContext } from "./context";
import { workspaceFingerprint } from "./fingerprint";

it("detects current tracked and untracked repository bytes, including preserved timestamps", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "fingerprint-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, windowsHide: true, stdio: "pipe" });
  try {
    git("init", "-q");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(cwd, "tracked"), "original\n");
    git("add", "tracked");
    git("commit", "-qm", "fixture");
    const untracked = join(cwd, "output");
    writeFileSync(untracked, "first");
    const stamp = statSync(untracked);
    const context = { store: { project: async () => ({ cwd }) } } as unknown as TaskContext;
    const task = { projectId: "fixture" } as HostTask;
    const original = await workspaceFingerprint(context, task);
    expect(original).toMatch(/^[a-f0-9]{64}$/);
    writeFileSync(untracked, "other");
    utimesSync(untracked, stamp.atime, stamp.mtime);
    const changedUntracked = await workspaceFingerprint(context, task);
    expect(changedUntracked).not.toBe(original);
    writeFileSync(join(cwd, "tracked"), "tracked contents changed\n");
    expect(await workspaceFingerprint(context, task)).not.toBe(changedUntracked);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
