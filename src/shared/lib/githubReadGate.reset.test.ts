import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  GithubRateLimitError,
  githubRateLimitResetAt,
  releaseGithubReadBlock,
  resetGithubReadBlock,
  withGithubRead,
} from "./githubReadGate";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const NOW = Date.parse("2026-01-01T12:00:00Z");
const limited =
  (text = "API rate limit exceeded for user") =>
  () =>
    Promise.reject(new Error(text));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resetGithubReadBlock();
});
afterEach(() => {
  resetGithubReadBlock();
  vi.useRealTimers();
});

it("takes the pause from the reset time GitHub states, not a fixed hour", async () => {
  expect(githubRateLimitResetAt("HTTP 403 retry-after: 90", NOW)).toBe(NOW + 90_000);
  expect(githubRateLimitResetAt("x-ratelimit-reset: 1767268800", NOW)).toBe(1767268800_000);
  expect(githubRateLimitResetAt("API rate limit exceeded", NOW)).toBeNull();

  const error = await withGithubRead(limited("API rate limit exceeded. retry-after: 120")).catch(
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(GithubRateLimitError);
  expect((error as GithubRateLimitError).until).toBe(NOW + 120_000);
  expect((error as GithubRateLimitError).stated).toBe(true);
});

it("a stated reset time is never bypassed by an explicit retry, and ends on its own", async () => {
  await withGithubRead(limited("secondary rate limit. retry-after: 120")).catch(() => {});
  expect(releaseGithubReadBlock()).toBe(false);
  vi.setSystemTime(NOW + 121_000);
  const work = vi.fn().mockResolvedValue("ok");
  await expect(withGithubRead(work)).resolves.toBe("ok");
});

it("an unstated pause lets an explicit retry probe after a minute instead of waiting an hour", async () => {
  await withGithubRead(limited()).catch(() => {});
  expect(releaseGithubReadBlock()).toBe(false);
  vi.setSystemTime(NOW + 61_000);
  expect(releaseGithubReadBlock()).toBe(true);
  await expect(withGithubRead(() => Promise.resolve(1))).resolves.toBe(1);
});

it("resetGithubReadBlock clears one scope or all of them, for example after an account change", async () => {
  await withGithubRead(limited(), "a").catch(() => {});
  await withGithubRead(limited(), "b").catch(() => {});
  resetGithubReadBlock("a");
  await expect(withGithubRead(() => Promise.resolve("a-ok"), "a")).resolves.toBe("a-ok");
  await expect(withGithubRead(() => Promise.resolve("b"), "b")).rejects.toBeInstanceOf(
    GithubRateLimitError,
  );
  resetGithubReadBlock();
  await expect(withGithubRead(() => Promise.resolve("b-ok"), "b")).resolves.toBe("b-ok");
  expect(invoke).not.toHaveBeenCalled();
});
