import { invoke } from "@tauri-apps/api/core";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => vi.useRealTimers());

it("blocks all GitHub read commands after quota exhaustion, then recovers at the fallback time", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const { githubRead } = await import("./githubReadGate");
  vi.mocked(invoke)
    .mockReset()
    .mockRejectedValueOnce(new Error("GraphQL: API rate limit already exceeded for user"));
  await expect(githubRead("git_github_work_items", {})).rejects.toThrow(
    "GitHub is limiting requests and gave no reset time",
  );
  await expect(githubRead("git_github_pr_checks", {})).rejects.toThrow("no reset time");
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
    .mockRejectedValueOnce(new Error("no issue called rate limit in this repository"))
    .mockResolvedValueOnce([]);
  await expect(githubRead("git_github_work_items", {})).rejects.toThrow("repository not found");
  await expect(githubRead("git_github_work_items", {})).rejects.toThrow("no issue called");
  await expect(githubRead("git_github_work_items", {})).resolves.toEqual([]);
});

it("shares quota protection between Inbox and the Git panel without blocking another host", async () => {
  vi.resetModules();
  const { githubRead, withGithubRead } = await import("./githubReadGate");
  vi.mocked(invoke)
    .mockReset()
    .mockRejectedValueOnce(new Error("GraphQL: API rate limit already exceeded"));
  await expect(githubRead("git_github_work_items", {})).rejects.toThrow("no reset time");
  const localPr = vi.fn(async () => null);
  await expect(withGithubRead(localPr)).rejects.toThrow("no reset time");
  expect(localPr).not.toHaveBeenCalled();
  const remotePr = vi.fn(async () => null);
  await expect(withGithubRead(remotePr, "other-host")).resolves.toBeNull();
  expect(remotePr).toHaveBeenCalledOnce();
});

it("waits for the reset GitHub stated, and an explicit retry never bypasses it", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const { GithubRateLimitError, githubRead, releaseGithubReadBlock } =
    await import("./githubReadGate");
  vi.mocked(invoke)
    .mockReset()
    .mockRejectedValueOnce(new Error("HTTP 403: secondary rate limit\nRetry-After: 120"));
  const first = await githubRead("git_github_work_items", {}).catch((error: unknown) => error);
  expect(first).toBeInstanceOf(GithubRateLimitError);
  expect((first as InstanceType<typeof GithubRateLimitError>).stated).toBe(true);
  expect(releaseGithubReadBlock()).toBe(false);
  await expect(githubRead("git_github_work_items", {})).rejects.toBeInstanceOf(
    GithubRateLimitError,
  );
  expect(invoke).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(119_000);
  expect(releaseGithubReadBlock()).toBe(false);
  vi.advanceTimersByTime(1_000);
  vi.mocked(invoke).mockResolvedValueOnce([]);
  await expect(githubRead("git_github_work_items", {})).resolves.toEqual([]);
});

it("lets an explicit retry probe an untimed pause after a minute, and re-pauses if still limited", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const { githubRead, releaseGithubReadBlock } = await import("./githubReadGate");
  vi.mocked(invoke)
    .mockReset()
    .mockRejectedValueOnce(new Error("API rate limit exceeded for user"))
    .mockRejectedValueOnce(new Error("API rate limit exceeded for user"))
    .mockResolvedValueOnce([]);
  await expect(githubRead("git_github_work_items", {})).rejects.toThrow("no reset time");
  expect(releaseGithubReadBlock()).toBe(false);
  vi.advanceTimersByTime(60_000);
  expect(releaseGithubReadBlock()).toBe(true);
  await expect(githubRead("git_github_work_items", {})).rejects.toThrow("no reset time");
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(releaseGithubReadBlock()).toBe(false);
  vi.advanceTimersByTime(60_000);
  expect(releaseGithubReadBlock()).toBe(true);
  await expect(githubRead("git_github_work_items", {})).resolves.toEqual([]);
});

it("clears a pause when the account changes, and never counts its own message as a new limit", async () => {
  vi.resetModules();
  const { githubRead, resetGithubReadBlock, withGithubRead } = await import("./githubReadGate");
  vi.mocked(invoke)
    .mockReset()
    .mockRejectedValueOnce(new Error("API rate limit exceeded for user"))
    .mockResolvedValueOnce([]);
  await expect(githubRead("git_github_work_items", {})).rejects.toThrow("no reset time");
  // A nested gated read rethrows the typed error without extending the pause.
  await expect(
    withGithubRead(() => githubRead("git_github_work_items", {}), "other-host"),
  ).rejects.toThrow("no reset time");
  resetGithubReadBlock("local");
  await expect(githubRead("git_github_work_items", {})).resolves.toEqual([]);
});

it("reads stated reset times from retry-after, reset epoch, UTC date and relative wording", async () => {
  const { githubRateLimitResetAt } = await import("../../../shared/lib/githubReadGate");
  const now = Date.UTC(2026, 10, 19, 12, 0, 0);
  expect(githubRateLimitResetAt("retry-after: 30", now)).toBe(now + 30_000);
  expect(githubRateLimitResetAt("x-ratelimit-reset: 1795000000", now)).toBe(1_795_000_000_000);
  expect(
    githubRateLimitResetAt("retry your request again after 2026-11-19 12:30:00 UTC", now),
  ).toBe(Date.UTC(2026, 10, 19, 12, 30, 0));
  expect(githubRateLimitResetAt("please try again in 5 minutes", now)).toBe(now + 300_000);
  expect(githubRateLimitResetAt("wait a few minutes before you try again", now)).toBeNull();
});
