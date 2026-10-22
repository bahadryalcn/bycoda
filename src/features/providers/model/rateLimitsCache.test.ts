import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { errorRateLimits, idleRateLimits, type ProviderRateLimits } from "./rateLimits";
import { fetchClaudeRateLimits } from "./rateLimitsFetch";
import {
  clearCachedRateLimits,
  getCachedRateLimits,
  getAllRateLimits,
  loadFreshRateLimits,
  loadRateLimits,
  refreshClaudeQuotaOnce,
} from "./rateLimitsCache";

vi.mock("./rateLimitsFetch", () => ({
  fetchClaudeRateLimits: vi.fn(),
  fetchCodexRateLimits: vi.fn(),
  fetchOpencodeGoRateLimits: vi.fn(),
}));

const fetchClaude = vi.mocked(fetchClaudeRateLimits);

it("explicit refresh shares a pending request, never queues replay or retries, and retains the old observation time on failure", async () => {
  fetchClaude.mockResolvedValueOnce(usage(40));
  await loadRateLimits("claude", "explicit");
  let finish!: (value: ProviderRateLimits) => void;
  fetchClaude.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = refreshClaudeQuotaOnce("explicit", () => true);
  const second = refreshClaudeQuotaOnce("explicit", () => true);
  finish(rateLimited());
  const [left, right] = await Promise.all([first, second]);
  expect(left).toEqual(right);
  expect(left.updatedAt).toBe(1_000_000);
  expect(left.session?.usedPercent).toBe(40);
  expect(fetchClaude).toHaveBeenLastCalledWith("explicit", true);
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(fetchClaude).toHaveBeenCalledTimes(2);
});

it("explicit refresh does not publish after the reviewed account/source becomes unavailable", async () => {
  let finish!: (value: ProviderRateLimits) => void;
  let allowed = true;
  fetchClaude.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const running = refreshClaudeQuotaOnce("private", () => allowed);
  allowed = false;
  finish(usage(12));
  await running;
  expect(getAllRateLimits()["claude:private"]).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

function usage(usedPercent: number): ProviderRateLimits {
  return {
    ...idleRateLimits("claude"),
    session: { usedPercent, windowMinutes: 300, resetsAt: null },
    updatedAt: Date.now(),
    status: "ok",
  };
}

const rateLimited = () => errorRateLimits("claude", "Claude usage request failed (429)");

it("does not restore a removed account or run its queued refresh after a late response", async () => {
  let resolve!: (value: ProviderRateLimits) => void;
  fetchClaude.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const running = loadRateLimits("claude", "account-removed");
  const queued = loadRateLimits("claude", "account-removed", true);
  clearCachedRateLimits("claude", "account-removed");
  resolve(rateLimited());
  await Promise.all([running, queued]);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(getAllRateLimits()["claude:account-removed"]).toBeUndefined();
  expect(fetchClaude).toHaveBeenCalledTimes(1);
});

it("keeps a new request when an invalidated old request completes", async () => {
  let resolve!: (value: ProviderRateLimits) => void;
  fetchClaude.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const old = loadRateLimits("claude");
  clearCachedRateLimits("claude", "default");
  fetchClaude.mockResolvedValueOnce(usage(12));
  await loadRateLimits("claude");
  resolve(usage(99));
  await old;
  expect(getCachedRateLimits("claude").session?.usedPercent).toBe(12);
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  fetchClaude.mockReset();
  clearCachedRateLimits();
});

afterEach(() => {
  clearCachedRateLimits();
  vi.useRealTimers();
});

it("keeps the last usage, with its own age, when a refresh is rate limited", async () => {
  fetchClaude.mockResolvedValueOnce(usage(40));
  await loadRateLimits("claude");
  vi.setSystemTime(1_000_000 + 8 * 60_000);
  fetchClaude.mockResolvedValueOnce(rateLimited());

  const result = await loadRateLimits("claude", "default", true);

  expect(result).toMatchObject({
    status: "error",
    error: "Claude usage request failed (429)",
    session: { usedPercent: 40 },
    updatedAt: 1_000_000,
  });
  expect(getCachedRateLimits("claude")).toBe(result);
});

it("tries again by itself after a failed read, and stops once it works", async () => {
  fetchClaude.mockResolvedValueOnce(rateLimited());
  await loadRateLimits("claude");
  expect(getCachedRateLimits("claude").status).toBe("error");

  fetchClaude.mockResolvedValueOnce(usage(12));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(getCachedRateLimits("claude")).toMatchObject({
    status: "ok",
    session: { usedPercent: 12 },
  });

  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(fetchClaude).toHaveBeenCalledTimes(2);
});

it("checks back soon while a Claude token awaits renewal by the CLI", async () => {
  const pendingRenewal = () => ({
    ...errorRateLimits("claude", "Claude usage will update when this account is used again"),
    renewalPending: true,
  });
  fetchClaude.mockResolvedValueOnce(pendingRenewal()).mockResolvedValueOnce(pendingRenewal());
  await loadRateLimits("claude");

  await vi.advanceTimersByTimeAsync(15_000);
  expect(fetchClaude).toHaveBeenCalledTimes(2);

  fetchClaude.mockResolvedValueOnce(usage(30));
  await vi.advanceTimersByTimeAsync(15_000);
  expect(getCachedRateLimits("claude")).toMatchObject({
    status: "ok",
    session: { usedPercent: 30 },
  });
});

it("shares a recent read instead of asking the provider again", async () => {
  fetchClaude.mockResolvedValue(usage(70));
  await loadRateLimits("claude");

  await loadFreshRateLimits("claude", "default", 60_000);
  expect(fetchClaude).toHaveBeenCalledTimes(1);

  vi.setSystemTime(1_000_000 + 61_000);
  await loadFreshRateLimits("claude", "default", 60_000);
  expect(fetchClaude).toHaveBeenCalledTimes(2);
});
