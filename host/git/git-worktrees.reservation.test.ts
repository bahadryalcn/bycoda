import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
const reservation = vi.hoisted(() => vi.fn());
vi.mock("./git-exec-pool", async (original) => {
  const actual = await original<typeof import("./git-exec-pool")>();
  return {
    ...actual,
    hostGitExec: {
      exec: (
        file: string,
        args: string[],
        options: Parameters<typeof actual.hostGitExec.exec>[2],
      ) =>
        args[0] === "update-ref" && args[1] === "--stdin"
          ? reservation(file, args, options)
          : actual.hostGitExec.exec(file, args, options),
    },
  };
});
import { materializeManagedWorkspace } from "./git-worktrees";
import { hostGitRepositoryKey } from "./git-mutations";
import type { ManagedWorkspace } from "../workspaces/workspace-contracts";

it("bounds failed reservation diagnostics and retains the inherited Git deadline", async () => {
  const root = mkdtempSync(join(tmpdir(), "bycoda-ref-reservation-"));
  const cwd = join(root, "repo");
  mkdirSync(cwd);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, windowsHide: true, timeout: 10_000 }).toString().trim();
  try {
    git("init", "-q");
    writeFileSync(join(cwd, "file"), "initial");
    git("add", "file");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "-qm",
      "initial",
    );
    reservation.mockImplementationOnce(async (_file, _args, options) => {
      options.onOutput("stderr", Buffer.from("original: " + "x".repeat(3 * 1024 * 1024)));
      options.onOutput("stderr", Buffer.from("later diagnostic".repeat(100_000)));
      throw Object.assign(new Error("exit"), { code: 1 });
    });
    const workspace = {
      id: "fixture-reservation",
      path: join(root, "workspace"),
      branchRef: "refs/heads/by/fixture",
      baseCommit: git("rev-parse", "HEAD"),
      repositoryId: await hostGitRepositoryKey(cwd),
    } as ManagedWorkspace;
    const error = await materializeManagedWorkspace(cwd, workspace, true).then(
      () => null,
      (error: Error) => error,
    );
    expect(error?.message).toBe(
      "Workspace branch reservation failed: " + ("original: " + "x".repeat(2000)).slice(0, 2000),
    );
    expect(reservation).toHaveBeenCalledWith(
      "git",
      ["update-ref", "--stdin"],
      expect.objectContaining({
        timeout: 120_000,
        windowsHide: true,
        input: expect.stringContaining("prepare\ncommit\n"),
      }),
    );
    expect(git("for-each-ref", "refs/bycoda/workspaces/fixture-reservation")).toBe("");
  } finally {
    reservation.mockReset();
    rmSync(root, { recursive: true, force: true });
  }
});

it("rejects a hung reservation with a timeout message when its deadline aborts git", async () => {
  const root = mkdtempSync(join(tmpdir(), "bycoda-ref-reservation-hung-"));
  const cwd = join(root, "repo");
  mkdirSync(cwd);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, windowsHide: true, timeout: 10_000 }).toString().trim();
  try {
    git("init", "-q");
    writeFileSync(join(cwd, "file"), "initial");
    git("add", "file");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "-qm",
      "initial",
    );
    reservation.mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
    const workspace = {
      id: "fixture-reservation-hung",
      path: join(root, "workspace"),
      branchRef: "refs/heads/by/fixture-hung",
      baseCommit: git("rev-parse", "HEAD"),
      repositoryId: await hostGitRepositoryKey(cwd),
    } as ManagedWorkspace;
    const error = await materializeManagedWorkspace(cwd, workspace, true).then(
      () => null,
      (error: Error) => error,
    );
    expect(error?.message).toBe("Workspace branch reservation timed out");
    expect(reservation).toHaveBeenCalledWith(
      "git",
      ["update-ref", "--stdin"],
      expect.objectContaining({ timeout: 120_000 }),
    );
    expect(git("for-each-ref", "refs/bycoda/workspaces/fixture-reservation-hung")).toBe("");
  } finally {
    reservation.mockReset();
    rmSync(root, { recursive: true, force: true });
  }
});
