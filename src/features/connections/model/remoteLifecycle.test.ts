import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  FEATURE_VERIFIED_REFRESH_MS,
  markRemoteFeaturesStale,
  readRemoteLifecycle,
  recordFeatureHealth,
  resetRemoteLifecyclesForTests,
  subscribeRemoteLifecycle,
} from "./remoteLifecycle";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  resetRemoteLifecyclesForTests();
});
afterEach(() => {
  vi.useRealTimers();
});

function countPublications(run: () => void) {
  const listener = vi.fn();
  const unsubscribe = subscribeRemoteLifecycle(listener);
  run();
  unsubscribe();
  return listener.mock.calls.length;
}

it("keeps the stored lifecycle and publishes nothing for repeated successes", () => {
  recordFeatureHealth("env", "sessions", true);
  const first = readRemoteLifecycle("env");
  const published = countPublications(() => {
    vi.advanceTimersByTime(FEATURE_VERIFIED_REFRESH_MS - 1);
    recordFeatureHealth("env", "sessions", true);
  });
  expect(published).toBe(0);
  expect(readRemoteLifecycle("env")).toBe(first);
});

it("refreshes the verification time once it is old enough", () => {
  recordFeatureHealth("env", "sessions", true);
  vi.advanceTimersByTime(FEATURE_VERIFIED_REFRESH_MS);
  const published = countPublications(() => recordFeatureHealth("env", "sessions", true));
  expect(published).toBe(1);
  expect(readRemoteLifecycle("env").features.sessions?.verifiedAt).toBe(
    1_000_000 + FEATURE_VERIFIED_REFRESH_MS,
  );
});

it("publishes recovery after a failure or stale mark even within the refresh window", () => {
  recordFeatureHealth("env", "git", true);
  expect(countPublications(() => recordFeatureHealth("env", "git", false))).toBe(1);
  expect(readRemoteLifecycle("env").features.git?.status).toBe("failed");
  expect(countPublications(() => recordFeatureHealth("env", "git", true))).toBe(1);
  expect(readRemoteLifecycle("env").features.git).toEqual({
    status: "ready",
    verifiedAt: 1_000_000,
  });

  markRemoteFeaturesStale("env");
  expect(readRemoteLifecycle("env").features.git?.status).toBe("stale");
  expect(countPublications(() => recordFeatureHealth("env", "git", true))).toBe(1);
  expect(readRemoteLifecycle("env").features.git?.status).toBe("ready");
});

it("does not republish a repeated failure and keeps the last verified time", () => {
  recordFeatureHealth("env", "files", true);
  recordFeatureHealth("env", "files", false);
  const failed = readRemoteLifecycle("env");
  vi.advanceTimersByTime(5_000);
  expect(countPublications(() => recordFeatureHealth("env", "files", false))).toBe(0);
  expect(readRemoteLifecycle("env")).toBe(failed);
  expect(failed.features.files?.verifiedAt).toBe(1_000_000);
});

it("keeps each machine's features independent", () => {
  recordFeatureHealth("env-a", "files", true);
  recordFeatureHealth("env-b", "files", false);
  vi.advanceTimersByTime(1_000);
  expect(countPublications(() => recordFeatureHealth("env-a", "files", true))).toBe(0);
  expect(readRemoteLifecycle("env-a").features.files?.status).toBe("ready");
  expect(readRemoteLifecycle("env-b").features.files?.status).toBe("failed");
});
