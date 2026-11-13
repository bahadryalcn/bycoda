// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
vi.mock("./roomPrivacyProjection", () => ({ queueRoomPrivacyProjection: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["{broken", "[]", '{"record":{"hash":"invalid"}}'])(
  "keeps corrupt privacy state unavailable without overwriting %s",
  async (raw) => {
    vi.resetModules();
    vi.stubGlobal("BroadcastChannel", undefined);
    localStorage.clear();
    localStorage.setItem("bycoda.groupLock", raw);
    const write = vi.spyOn(localStorage, "setItem");
    const model = await import("./groupLock");
    expect(model.getGroupLockView().storageAvailable).toBe(false);
    expect(model.setStartInPrivacyMode(true)).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(localStorage.getItem("bycoda.groupLock")).toBe(raw);
    expect(model.retryGroupLockStorage()).toBe(false);
  },
);

it("keeps read failure unknown and recovers read-only; missing key remains first run", async () => {
  vi.resetModules();
  vi.stubGlobal("BroadcastChannel", undefined);
  localStorage.clear();
  const read = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const model = await import("./groupLock");
  expect(model.getGroupLockView().storageAvailable).toBe(false);
  read.mockRestore();
  const write = vi.spyOn(localStorage, "setItem");
  expect(model.retryGroupLockStorage()).toBe(true);
  expect(model.getGroupLockView().hasPassword).toBe(false);
  expect(write).not.toHaveBeenCalled();
});

it("retains non-secret failed option outcomes until a durable whole-record save", async () => {
  vi.resetModules();
  vi.stubGlobal("BroadcastChannel", undefined);
  localStorage.clear();
  const model = await import("./groupLock");
  const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  expect(model.setStartInPrivacyMode(true)).toBe(false);
  expect(model.getGroupLockView().unsavedOptions).toContain("startInPrivacyMode");
  expect(model.getGroupLockView().settings.startInPrivacyMode).toBe(true);
  write.mockRestore();
  expect(model.setRelockOnLaunch(false)).toBe(true);
  expect(model.getGroupLockView().unsavedOptions).toEqual([]);
});

it("recovers saved concealment after reads resume without granting temporary visibility", async () => {
  vi.resetModules();
  vi.stubGlobal("BroadcastChannel", undefined);
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  const { createPasswordRecord } = await import("./passwordRecord");
  const record = await createPasswordRecord("synthetic-password");
  const raw = JSON.stringify({ record });
  localStorage.setItem("bycoda.groupLock", raw);
  localStorage.setItem(
    "bycoda.projectGroups",
    JSON.stringify([{ id: "hidden", name: "Synthetic hidden group" }]),
  );
  localStorage.setItem("bycoda.groupLock.hiddenGroups.v1", '["hidden"]');
  const read = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const model = await import("./groupLock");
  read.mockRestore();
  expect(model.retryGroupLockStorage()).toBe(true);
  expect(model.getGroupLockView().hiddenGroupIds.has("hidden")).toBe(true);
  expect(model.getGroupLockView().hiddenGroupsAuthorized).toBe(false);
  expect(model.getGroupLockView().hasPassword).toBe(true);
  expect(localStorage.getItem("bycoda.groupLock")).toBe(raw);
});
