import { expect, it, vi } from "vitest";
import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import type { TaskContext } from "./context";
import { acceptanceFingerprint, shouldFingerprintFailedCheck } from "./fingerprint";

it("fingerprints only completed failed checks", () => {
  expect(shouldFingerprintFailedCheck({ timedOut: false, exitCode: 1 })).toBe(true);
  expect(shouldFingerprintFailedCheck({ timedOut: true, exitCode: 1 })).toBe(false);
  expect(shouldFingerprintFailedCheck({ timedOut: false, exitCode: null })).toBe(false);
  expect(shouldFingerprintFailedCheck({ timedOut: false, exitCode: 0 })).toBe(false);
});

it("uses the repository snapshot captured in the same review", async () => {
  const workspaceFingerprint = vi.fn(async () => "unexpected");
  const context = { workspaceFingerprint } as unknown as TaskContext;
  const task = { worktreeCwd: process.cwd(), prompt: "Review the changes" } as HostTask;
  const result = await acceptanceFingerprint(context, task, "fresh-repository-snapshot");
  expect(result).toMatch(/^[a-f0-9]{64}$/);
  expect(workspaceFingerprint).not.toHaveBeenCalled();
});
