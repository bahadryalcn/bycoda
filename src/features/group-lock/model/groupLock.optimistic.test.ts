// @vitest-environment happy-dom
import { webcrypto } from "node:crypto";
import { expect, it, vi } from "vitest";
const pending = vi.hoisted(() => ({ reject: undefined as undefined | ((error: Error) => void) }));
vi.mock("./roomPrivacyProjection", () => ({
  queueRoomPrivacyProjection: () => {},
  withRoomPrivacyMutation: () =>
    new Promise((_resolve, reject) => {
      pending.reject = reject;
    }),
}));

it("conceals immediately while drain is pending and stays concealed if it fails", async () => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("BroadcastChannel", undefined);
  localStorage.clear();
  const { createPasswordRecord } = await import("./passwordRecord");
  const record = await createPasswordRecord("correct-password");
  localStorage.setItem("bycoda.groupLock", JSON.stringify({ record, relockOnLaunch: false }));
  localStorage.setItem("bycoda.groupLock.unlocked", JSON.stringify(["private"]));
  localStorage.setItem(
    "bycoda.projectGroups",
    JSON.stringify([{ id: "private", name: "Private", lockable: true }]),
  );
  localStorage.setItem("bycoda.projectGroupAssignments", JSON.stringify({ "/private": "private" }));
  const model = await import("./groupLock");
  expect(model.isProjectLocked("/private")).toBe(false);
  const result = model.lockGroup("private");
  expect(model.isProjectLocked("/private")).toBe(true);
  pending.reject!(new Error("drain failed"));
  await expect(result).rejects.toThrow("drain failed");
  expect(model.isProjectLocked("/private")).toBe(true);
  expect(JSON.parse(localStorage.getItem("bycoda.groupLock.unlocked")!)).toEqual(["private"]);
  vi.unstubAllGlobals();
});
