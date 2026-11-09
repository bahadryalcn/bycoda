import { expect, it } from "vitest";
import { summarizeSync } from "./syncSummary";

const now = 1_000_000_000_000;
const UNREACHABLE = "Machine is unreachable. Check the host and SSH tunnel, then reconnect.";

it("shows a calm synced line, with a relative time when known", () => {
  expect(summarizeSync({ state: "ok", pendingOps: 0 }, now)).toEqual({
    tone: "muted",
    text: "Synced",
  });
  expect(summarizeSync({ state: "ok", lastSyncAt: now - 10_000, pendingOps: 0 }, now)).toEqual({
    tone: "muted",
    text: "Synced now",
  });
  const older = summarizeSync({ state: "ok", lastSyncAt: now - 5 * 60_000, pendingOps: 0 }, now);
  expect(older.tone).toBe("muted");
  expect(older.text).toMatch(/^Synced .*5/);
});

it("maps the quiet states", () => {
  expect(summarizeSync({ state: "syncing", pendingOps: 0 }, now).text).toBe("Syncing…");
  expect(summarizeSync({ state: "idle", pendingOps: 0 }, now).text).toBe("Sync has not run yet");
  expect(summarizeSync({ state: "unsupported", pendingOps: 0 }, now)).toEqual({
    tone: "warning",
    text: "Sync is unavailable. Update the host on this machine.",
  });
  expect(summarizeSync({ state: "unlinked", pendingOps: 0 }, now)).toEqual({
    tone: "warning",
    text: "Sync is not linked yet.",
  });
});

it("treats an unreachable or temporary machine as a paused retry, not a failure", () => {
  const paused = {
    tone: "warning",
    text: "Sync is paused because this machine did not answer. It retries automatically.",
  };
  expect(summarizeSync({ state: "error", lastError: UNREACHABLE, pendingOps: 0 }, now)).toEqual(
    paused,
  );
  expect(
    summarizeSync({ state: "error", lastError: "[RPC_TIMEOUT] timed out", pendingOps: 0 }, now),
  ).toEqual(paused);
});

it("shows other errors as danger with sanitized text and an unknown fallback", () => {
  expect(
    summarizeSync({ state: "error", lastError: "Disk full token=abc123", pendingOps: 0 }, now),
  ).toEqual({ tone: "danger", text: "Sync failed: Disk full token …" });
  expect(summarizeSync({ state: "error", pendingOps: 0 }, now).text).toBe(
    "Sync failed: unknown error",
  );
});

it("appends pending changes to every state", () => {
  expect(summarizeSync({ state: "syncing", pendingOps: 3 }, now).text).toBe(
    "Syncing… · 3 pending changes",
  );
  expect(summarizeSync({ state: "error", lastError: UNREACHABLE, pendingOps: 2 }, now).text).toMatch(
    / · 2 pending changes$/,
  );
});
