import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
const processMock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
  ...await original<typeof import("node:child_process")>(),
  spawn: processMock.spawn,
}));
import { materializeManagedWorkspace } from "./git-worktrees";
import { hostGitRepositoryKey } from "./git-mutations";
import type { ManagedWorkspace } from "../workspace-contracts";

it("bounds failed reservation diagnostics and retains the inherited Git deadline", async () => {
  const root = mkdtempSync(join(tmpdir(), "bycoda-ref-reservation-"));
  const cwd = join(root, "repo");
  mkdirSync(cwd);
  const git = (...args: string[]) => execFileSync("git", args, { cwd, windowsHide: true, timeout: 10_000 }).toString().trim();
  try {
    git("init", "-q");
    writeFileSync(join(cwd, "file"), "initial");
    git("add", "file");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-qm", "initial");
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stderr: new PassThrough() });
    processMock.spawn.mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.stderr.emit("data", "original: " + "x".repeat(3 * 1024 * 1024));
        child.stderr.emit("data", "later diagnostic".repeat(100_000));
        child.emit("close", 1);
      });
      return child;
    });
    const workspace = {
      id: "fixture-reservation", path: join(root, "workspace"),
      branchRef: "refs/heads/bycoda/s/fixture", baseCommit: git("rev-parse", "HEAD"),
      repositoryId: await hostGitRepositoryKey(cwd),
    } as ManagedWorkspace;
    const error = await materializeManagedWorkspace(cwd, workspace, true).then(() => null, (error: Error) => error);
    expect(error?.message).toBe("Workspace branch reservation failed: " + ("original: " + "x".repeat(2000)).slice(0, 2000));
    expect(processMock.spawn).toHaveBeenCalledWith("git", ["update-ref", "--stdin"], expect.objectContaining({ timeout: 120_000, windowsHide: true }));
    expect(git("for-each-ref", "refs/bycoda/workspaces/fixture-reservation")).toBe("");
  } finally {
    processMock.spawn.mockReset();
    rmSync(root, { recursive: true, force: true });
  }
});
