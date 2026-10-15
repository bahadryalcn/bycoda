import { invoke } from "@tauri-apps/api/core";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => vi.useRealTimers());

it("blocks all GitHub read commands after quota exhaustion, even on manual retry, then recovers", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const { githubRead } = await import("./githubReadGate");
  vi.mocked(invoke)
    .mockReset()
    .mockRejectedValueOnce(new Error("GraphQL: API rate limit already exceeded for user"));
  await expect(githubRead("git_github_work_items", {})).rejects.toThrow("paused until");
  await expect(githubRead("git_github_pr_checks", {})).rejects.toThrow("paused until");
  expect(invoke).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(60 * 60_000);
  vi.mocked(invoke).mockResolvedValueOnce([]);
  await expect(githubRead("git_github_work_items", {})).resolves.toEqual([]);
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("does not globally block reads for an unrelated repository error", async () => {
  vi.resetModules();
  const { githubRead } = await import("./githubReadGate");
  vi.mocked(invoke)
    .mockReset()
    .mockRejectedValueOnce(new Error("repository not found"))
    .mockResolvedValueOnce([]);
  await expect(githubRead("git_github_work_items", {})).rejects.toThrow("repository not found");
  await expect(githubRead("git_github_work_items", {})).resolves.toEqual([]);
});

it("shares quota protection between Inbox and the Git panel without blocking another host", async () => {
  vi.resetModules();
  const { githubRead, withGithubRead } = await import("./githubReadGate");
  vi.mocked(invoke)
    .mockReset()
    .mockRejectedValueOnce(new Error("GraphQL: API rate limit already exceeded"));
  await expect(githubRead("git_github_work_items", {})).rejects.toThrow("paused until");
  const localPr = vi.fn(async () => null);
  await expect(withGithubRead(localPr)).rejects.toThrow("paused until");
  expect(localPr).not.toHaveBeenCalled();
  const remotePr = vi.fn(async () => null);
  await expect(withGithubRead(remotePr, "other-host")).resolves.toBeNull();
  expect(remotePr).toHaveBeenCalledOnce();
});
