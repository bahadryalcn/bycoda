// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { pathKey } from "../../../shared/lib/paths";

const HIDDEN_KEY = "bycoda.groupLock.hiddenGroups.v1";
afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("crypto", webcrypto);
  localStorage.clear();
  localStorage.setItem(
    "bycoda.projectGroups",
    JSON.stringify([
      { id: "personal", name: "Secret personal projects", collapsed: false },
      { id: "work", name: "Work", collapsed: false, lockable: true },
    ]),
  );
  localStorage.setItem(
    "bycoda.projectGroupAssignments",
    JSON.stringify({
      [pathKey("/personal")]: "personal",
      [pathKey("/work")]: "work",
    }),
  );
});

it("hides without a password, preserves membership and survives a restart", async () => {
  const model = await import("./groupLock");
  expect(model.hideGroup("personal")).toBe(true);
  expect(model.visibleProjects(["/personal", "/work"], (path) => path)).toEqual(["/work"]);
  expect(model.getGroupLockView().hiddenGroupIds.has("personal")).toBe(true);
  expect(
    JSON.parse(localStorage.getItem("bycoda.projectGroupAssignments")!)[pathKey("/personal")],
  ).toBe("personal");
  vi.resetModules();
  const restarted = await import("./groupLock");
  expect(restarted.isProjectLocked("/personal")).toBe(true);
  expect(restarted.restoreHiddenGroup("personal")).toBe(true);
  expect(restarted.isProjectLocked("/personal")).toBe(false);
  expect(JSON.parse(localStorage.getItem(HIDDEN_KEY)!)).toEqual([]);
});

it("keeps the old password when persisting a replacement fails", async () => {
  const model = await import("./groupLock");
  await model.setLockPassword("old-password");
  const stored = localStorage.getItem("bycoda.groupLock");
  const original = localStorage.setItem.bind(localStorage);
  const write = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
    if (key === "bycoda.groupLock") throw new Error("Storage unavailable");
    original(key, value);
  });
  try {
    await expect(model.setLockPassword("replacement-password")).rejects.toThrow(
      "Storage unavailable",
    );
    expect(localStorage.getItem("bycoda.groupLock")).toBe(stored);
    expect((await model.verifyLockPassword("old-password")).ok).toBe(true);
  } finally {
    write.mockRestore();
  }
});

it("temporary restoration hides again at restart and when locking all groups", async () => {
  const model = await import("./groupLock");
  model.hideGroup("personal");
  expect(model.restoreHiddenGroup("personal", true)).toBe(true);
  expect(model.isProjectLocked("/personal")).toBe(false);
  expect(JSON.parse(localStorage.getItem(HIDDEN_KEY)!)).toEqual(["personal"]);
  model.lockAllGroups();
  expect(model.isProjectLocked("/personal")).toBe(true);
  model.restoreHiddenGroup("personal", true);
  vi.resetModules();
  expect((await import("./groupLock")).isProjectLocked("/personal")).toBe(true);
});

it("requires verification and restores only the chosen group with unlock-all enabled", async () => {
  const model = await import("./groupLock");
  await model.setLockPassword("correct-password");
  model.setUnlockAll(true);
  model.hideGroup("personal");
  expect(model.restoreHiddenGroup("personal")).toBe(false);
  expect((await model.authorizeHiddenGroups("incorrect-password")).ok).toBe(false);
  expect(model.getGroupLockView().hiddenGroupsAuthorized).toBe(false);
  expect((await model.authorizeHiddenGroups("correct-password")).ok).toBe(true);
  expect(model.restoreHiddenGroup("personal", true)).toBe(true);
  expect(model.isProjectLocked("/personal")).toBe(false);
  expect(model.isProjectLocked("/work")).toBe(true);
  model.lockAllGroups();
  expect(model.getGroupLockView().hiddenGroupsAuthorized).toBe(false);
  expect(model.restoreHiddenGroup("personal")).toBe(false);
});

it("updates hidden state from another window and ignores deleted group ids", async () => {
  const model = await import("./groupLock");
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(["personal", "deleted"]));
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: HIDDEN_KEY,
      newValue: localStorage.getItem(HIDDEN_KEY),
    }),
  );
  expect([...model.getGroupLockView().hiddenGroupIds]).toEqual(["personal"]);
  expect(model.isProjectLocked("/personal")).toBe(true);
});

it("mirrors temporary visibility and re-hiding through the window channel", async () => {
  let receive: ((event: MessageEvent) => void) | null = null;
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      set onmessage(handler: (event: MessageEvent) => void) {
        receive = handler;
      }
      postMessage() {}
    },
  );
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(["personal"]));
  const model = await import("./groupLock");
  receive!(
    new MessageEvent("message", {
      data: {
        type: "state",
        groupIds: ["personal"],
        visibleHiddenIds: ["personal"],
      },
    }),
  );
  expect(model.isProjectLocked("/personal")).toBe(false);
  receive!(
    new MessageEvent("message", {
      data: { type: "state", groupIds: [], visibleHiddenIds: [] },
    }),
  );
  expect(model.isProjectLocked("/personal")).toBe(true);
});

it("keeps hidden preferences after password recovery and conceals temporary groups", async () => {
  const model = await import("./groupLock");
  model.hideGroup("personal");
  model.restoreHiddenGroup("personal", true);
  model.resetForgottenPassword();
  expect(model.isProjectLocked("/personal")).toBe(true);
  expect(model.restoreHiddenGroup("personal")).toBe(true);
});

it("hiding alone does not prevent background execution, while explicit password locks do", async () => {
  const model = await import("./groupLock");
  model.hideGroup("personal");
  expect(model.isProjectLocked("/personal")).toBe(true);
  expect(model.isProjectPasswordLocked("/personal")).toBe(false);
  await model.setLockPassword("correct-password");
  model.makeGroupLockable("work");
  model.hideGroup("work");
  expect(model.isProjectPasswordLocked("/work")).toBe(false);
  model.lockGroup("work");
  expect(model.isProjectPasswordLocked("/work")).toBe(true);
});

it("does not claim success when persistence fails", async () => {
  const model = await import("./groupLock");
  const storage = localStorage;
  vi.stubGlobal("localStorage", {
    getItem: storage.getItem.bind(storage),
    setItem: () => {
      throw new Error("quota");
    },
  });
  expect(model.hideGroup("personal")).toBe(false);
  expect(model.isProjectLocked("/personal")).toBe(false);
});

function failWrites(match: (key: string) => boolean) {
  const original = localStorage.setItem.bind(localStorage);
  return vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
    if (match(key)) throw new Error("quota");
    original(key, value);
  });
}

it("reports whether option choices reached storage", async () => {
  const model = await import("./groupLock");
  expect(model.setStartInPrivacyMode(true)).toBe(true);
  const write = failWrites((key) => key === "bycoda.groupLock");
  try {
    expect(model.setStartInPrivacyMode(false)).toBe(false);
    expect(model.setRelockOnLaunch(false)).toBe(false);
    expect(model.setAutoLockMinutes(15)).toBe(false);
    expect(model.setUnlockAll(true)).toBe(false);
    // This window keeps the choice it just applied; storage keeps the previous one.
    expect(model.getGroupLockView().settings.startInPrivacyMode).toBe(false);
    expect(JSON.parse(localStorage.getItem("bycoda.groupLock")!).startInPrivacyMode).toBe(true);
  } finally {
    write.mockRestore();
  }
});

it("does not mark a group lockable or unlock it when the flag cannot be saved", async () => {
  const model = await import("./groupLock");
  await model.setLockPassword("correct-password");
  const write = failWrites((key) => key === "bycoda.projectGroups");
  try {
    expect(model.makeGroupLockable("personal")).toBe(false);
  } finally {
    write.mockRestore();
  }
  expect(
    JSON.parse(localStorage.getItem("bycoda.projectGroups")!).find(
      (group: { id: string }) => group.id === "personal",
    ).lockable,
  ).toBeUndefined();
  expect(model.makeGroupLockable("personal")).toBe(true);
});

it("reports a group lock removal whose flag was not saved without losing the lock", async () => {
  const model = await import("./groupLock");
  await model.setLockPassword("correct-password");
  const write = failWrites((key) => key === "bycoda.projectGroups");
  try {
    expect(await model.removeGroupLock("work", "correct-password")).toEqual({
      ok: true,
      incomplete: "not-saved",
    });
  } finally {
    write.mockRestore();
  }
  expect(model.isProjectLocked("/work")).toBe(true);
});

it("keeps the password when its removal cannot be saved and reports a partial removal", async () => {
  const model = await import("./groupLock");
  await model.setLockPassword("correct-password");
  const stored = localStorage.getItem("bycoda.groupLock");

  const settingsWrite = failWrites((key) => key === "bycoda.groupLock");
  try {
    expect(await model.removeLockPassword("correct-password")).toEqual({
      ok: true,
      incomplete: "not-saved",
    });
  } finally {
    settingsWrite.mockRestore();
  }
  expect(localStorage.getItem("bycoda.groupLock")).toBe(stored);
  expect(model.getGroupLockView().hasPassword).toBe(true);
  expect(JSON.parse(localStorage.getItem("bycoda.projectGroups")!)[1].lockable).toBe(true);

  const groupsWrite = failWrites((key) => key === "bycoda.projectGroups");
  try {
    expect(model.resetForgottenPassword()).toBe("partial");
  } finally {
    groupsWrite.mockRestore();
  }
  expect(model.getGroupLockView().hasPassword).toBe(false);
  expect(JSON.parse(localStorage.getItem("bycoda.projectGroups")!)[1].lockable).toBe(true);
  // Projects stay in their groups; only the saved lock flag is left to review.
  expect(model.resetForgottenPassword()).toBe("complete");
});
