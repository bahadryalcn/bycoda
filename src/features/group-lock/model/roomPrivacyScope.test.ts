// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.stubGlobal("BroadcastChannel", undefined);
});

it("rejects corrupt privacy storage rather than qualifying an empty policy", async () => {
  localStorage.setItem("bycoda.projectGroupAssignments", "{");
  const { readRoomPrivacyScope } = await import("./roomPrivacyScope");
  expect(() => readRoomPrivacyScope()).toThrow();
});

it("does not include password records in the policy snapshot", async () => {
  const lock = await import("./groupLock");
  await lock.setLockPassword("private password");
  const stored = JSON.parse(localStorage.getItem("bycoda.groupLock")!);
  const { readRoomPrivacyScope } = await import("./roomPrivacyScope");
  const snapshot = JSON.stringify(readRoomPrivacyScope());
  expect(snapshot).not.toContain(stored.record.hash);
  expect(snapshot).not.toContain("private password");
});
it("includes current effective locks in the committed policy snapshot", async () => {
  localStorage.setItem(
    "bycoda.projectGroups",
    JSON.stringify([{ id: "private", name: "Private", collapsed: false }]),
  );
  const lock = await import("./groupLock");
  const { readRoomPrivacyScope } = await import("./roomPrivacyScope");
  expect(readRoomPrivacyScope().stableStorageKeys.lockedGroupIds).toEqual([]);
  expect(await lock.hideGroup("private")).toBe(true);
  expect(readRoomPrivacyScope().stableStorageKeys.lockedGroupIds).toEqual(["private"]);
});
