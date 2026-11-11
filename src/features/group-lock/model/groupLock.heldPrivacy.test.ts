// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), verify: vi.fn(), create: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: mocks.invoke }));
vi.mock("./roomPrivacyScope", () => ({
  readRoomPrivacyScope: () => ({ stableStorageKeys: { groups: [] } }),
}));
vi.mock("./passwordRecord", async (original) => ({
  ...(await original<typeof import("./passwordRecord")>()),
  verifyPassword: mocks.verify,
  createPasswordRecord: mocks.create,
}));

const record = {
  v: 1 as const,
  alg: "PBKDF2-SHA256" as const,
  iterations: 600_000,
  salt: "AAAAAAAAAAAAAAAAAAAAAA==",
  hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
};
const failure = "RPC_WS_DEADLINE: Host request deadline elapsed before dispatch";
const hostUp = (command: string) =>
  Promise.resolve(
    command === "control_privacy_projection_read" ? { revision: 4 } : { revision: 5 },
  );
const hostDown = (command: string) =>
  command === "control_privacy_projection_read"
    ? Promise.resolve({ revision: 4 })
    : Promise.reject(new Error(failure));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("BroadcastChannel", undefined);
  localStorage.clear();
  localStorage.setItem(
    "bycoda.projectGroups",
    JSON.stringify([{ id: "work", name: "Work", collapsed: true, lockable: true }]),
  );
  mocks.verify.mockReset().mockResolvedValue(true);
  mocks.create.mockReset().mockResolvedValue(record);
  mocks.invoke.mockReset().mockImplementation(hostUp);
});
afterEach(() => vi.unstubAllGlobals());

async function lockedWithHeldFailure() {
  const projection = await import("./roomPrivacyProjection");
  const model = await import("./groupLock");
  projection.activateRoomPrivacyProjection();
  await model.setLockPassword("synthetic-initial");
  await model.lockAllGroups();
  mocks.invoke.mockImplementation(hostDown);
  projection.queueRoomPrivacyProjection();
  await vi.waitFor(() => expect(projection.getRoomPrivacyStatus().error).toBe(failure));
  return { projection, model };
}

it("settles a held Host failure before unlocking with the right password", async () => {
  const { projection, model } = await lockedWithHeldFailure();
  mocks.invoke.mockImplementation(hostUp);
  await expect(model.unlockGroup("work", "synthetic-initial")).resolves.toEqual({ ok: true });
  expect(model.getGroupLockView().lock.lockedGroupIds).not.toContain("work");
  expect(projection.getRoomPrivacyStatus().error).toBeNull();
  projection.deactivateRoomPrivacyProjection();
});

it("keeps the group locked and reports the failure while the Host stays unreachable", async () => {
  const { projection, model } = await lockedWithHeldFailure();
  await expect(model.unlockGroup("work", "synthetic-initial")).rejects.toThrow(failure);
  expect(model.getGroupLockView().lock.lockedGroupIds).toContain("work");
  projection.deactivateRoomPrivacyProjection();
});

it("does not retry the held failure for a wrong password", async () => {
  const { projection, model } = await lockedWithHeldFailure();
  mocks.invoke.mockReset().mockImplementation(hostUp);
  mocks.verify.mockResolvedValue(false);
  await expect(model.unlockGroup("work", "synthetic-wrong")).resolves.toMatchObject({
    ok: false,
    reason: "wrong",
  });
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(projection.getRoomPrivacyStatus().error).toBe(failure);
  projection.deactivateRoomPrivacyProjection();
});
