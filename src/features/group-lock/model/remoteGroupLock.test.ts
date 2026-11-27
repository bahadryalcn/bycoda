// @vitest-environment happy-dom
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./roomPrivacyProjection", () => ({
  queueRoomPrivacyProjection: vi.fn(),
  settleHeldRoomPrivacyProjection: async () => {},
  withRoomPrivacyMutation: async <T>(run: () => T) => run(),
}));

async function setup(options: { hidden?: string[]; password?: boolean } = {}) {
  vi.resetModules();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("BroadcastChannel", undefined);
  localStorage.clear();
  const { createPasswordRecord } = await import("./passwordRecord");
  if (options.password !== false)
    localStorage.setItem(
      "bycoda.groupLock",
      JSON.stringify({
        record: await createPasswordRecord("right-password"),
        relockOnLaunch: true,
      }),
    );
  localStorage.setItem(
    "bycoda.projectGroups",
    JSON.stringify([
      { id: "private", name: "Private", lockable: true },
      { id: "plain", name: "Plain" },
      { id: "secret", name: "Secret" },
    ]),
  );
  localStorage.setItem("bycoda.projectGroupAssignments", JSON.stringify({ "/private": "private" }));
  if (options.hidden)
    localStorage.setItem("bycoda.groupLock.hiddenGroups.v1", JSON.stringify(options.hidden));
  const model = await import("./groupLock");
  const relay = await import("./remoteGroupLock");
  return { model, relay };
}

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.unstubAllGlobals());

it("answers with a verdict only, and never unlocks the desktop", async () => {
  const { model, relay } = await setup();
  expect(model.getGroupLockView().lock.lockedGroupIds.has("private")).toBe(true);
  const ok = await relay.runRemoteGroupLockJob({
    id: "1",
    kind: "unlock",
    groupId: "private",
    password: "right-password",
  });
  expect(ok).toEqual({ id: "1", result: "ok" });
  expect(JSON.stringify(ok)).not.toMatch(/hash|salt|record/i);
  expect(model.getGroupLockView().lock.lockedGroupIds.has("private")).toBe(true);
  expect(model.isProjectLocked("/private")).toBe(true);
});

it("answers a wrong password and an unknown or open group identically", async () => {
  const { relay } = await setup();
  const wrong = await relay.runRemoteGroupLockJob({
    id: "a",
    kind: "unlock",
    groupId: "private",
    password: "nope",
  });
  const unknownWithRightPassword = await relay.runRemoteGroupLockJob({
    id: "a",
    kind: "unlock",
    groupId: "missing",
    password: "right-password",
  });
  const openGroup = await relay.runRemoteGroupLockJob({
    id: "a",
    kind: "unlock",
    groupId: "plain",
    password: "right-password",
  });
  expect(wrong.result).toBe("wrong");
  expect(unknownWithRightPassword).toEqual({ id: "a", result: "wrong" });
  expect(openGroup).toEqual({ id: "a", result: "wrong" });
  expect(wrong).not.toHaveProperty("error");
});

it("shares the desktop's attempt throttle", async () => {
  const { model, relay } = await setup();
  const guess = (id: string) =>
    relay.runRemoteGroupLockJob({ id, kind: "unlock", groupId: "private", password: "guess" });
  let last = await guess("0");
  for (let attempt = 1; attempt < 12 && last.result !== "throttled"; attempt += 1)
    last = await guess(String(attempt));
  expect(last.result).toBe("throttled");
  expect(last.retryAfterMs).toBeGreaterThan(0);
  // The desktop's own dialogs are blocked by the same counter, and a right password stays refused.
  expect(model.lockCooldownMs()).toBeGreaterThan(0);
  expect(
    await relay.runRemoteGroupLockJob({
      id: "z",
      kind: "unlock",
      groupId: "private",
      password: "right-password",
    }),
  ).toMatchObject({ result: "throttled" });
});

it("authorizes the hidden list with the same password, or freely when none is set", async () => {
  const { relay } = await setup();
  expect(
    await relay.runRemoteGroupLockJob({ id: "h", kind: "authorizeHidden", password: "no" }),
  ).toMatchObject({
    result: "wrong",
  });
  expect(
    await relay.runRemoteGroupLockJob({
      id: "h",
      kind: "authorizeHidden",
      password: "right-password",
    }),
  ).toEqual({ id: "h", result: "ok" });
  const open = await setup({ password: false });
  expect(
    await open.relay.runRemoteGroupLockJob({ id: "h", kind: "authorizeHidden", password: "x" }),
  ).toEqual({
    id: "h",
    result: "ok",
  });
});

it("hides and unhides a group without touching the desktop's own hidden-list state", async () => {
  const { model, relay } = await setup({ hidden: ["secret"] });
  expect(model.getGroupLockView().hiddenGroupsAuthorized).toBe(false);
  expect(
    await relay.runRemoteGroupLockJob({
      id: "u",
      kind: "setHidden",
      groupId: "secret",
      hidden: false,
    }),
  ).toEqual({
    id: "u",
    result: "ok",
  });
  expect(model.getGroupLockView().hiddenGroupIds.has("secret")).toBe(false);
  expect(model.getGroupLockView().hiddenGroupsAuthorized).toBe(false);
  expect(
    await relay.runRemoteGroupLockJob({
      id: "h",
      kind: "setHidden",
      groupId: "plain",
      hidden: true,
    }),
  ).toEqual({
    id: "h",
    result: "ok",
  });
  expect(model.getGroupLockView().hiddenGroupIds.has("plain")).toBe(true);
  expect(
    await relay.runRemoteGroupLockJob({
      id: "n",
      kind: "setHidden",
      groupId: "ghost",
      hidden: false,
    }),
  ).toEqual({
    id: "n",
    error: "failed",
  });
});

it("moves the grant epoch when the desktop locks everything or changes its password", async () => {
  const { model } = await setup();
  const before = model.getRemoteGrantEpoch();
  expect(model.getRemoteGrantEpoch()).toBe(before);
  await model.unlockGroup("private", "right-password");
  expect(model.getRemoteGrantEpoch()).toBe(before);
  await model.lockAllGroups();
  const afterLockAll = model.getRemoteGrantEpoch();
  expect(afterLockAll).not.toBe(before);
  await model.changeLockPassword("right-password", "another-password");
  expect(model.getRemoteGrantEpoch()).not.toBe(afterLockAll);
});

it("tells the phone to retry when privacy storage is unreadable instead of granting", async () => {
  vi.resetModules();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("BroadcastChannel", undefined);
  localStorage.clear();
  localStorage.setItem("bycoda.groupLock", "{broken");
  const relay = await import("./remoteGroupLock");
  expect(
    await relay.runRemoteGroupLockJob({
      id: "s",
      kind: "unlock",
      groupId: "private",
      password: "x",
    }),
  ).toEqual({ id: "s", error: "failed" });
});
