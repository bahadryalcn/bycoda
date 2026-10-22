// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ verify: vi.fn(), create: vi.fn() }));
vi.mock("./passwordRecord", async (original) => ({ ...await original<typeof import("./passwordRecord")>(), verifyPassword: state.verify, createPasswordRecord: state.create }));
const record = { v: 1 as const, alg: "PBKDF2-SHA256" as const, iterations: 600_000, salt: "AAAAAAAAAAAAAAAAAAAAAA==", hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" };
const nextRecord = { ...record, hash: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=" };
beforeEach(() => {
  vi.resetModules(); vi.stubGlobal("BroadcastChannel", undefined); localStorage.clear();
  localStorage.setItem("bycoda.projectGroups", JSON.stringify([{ id: "work", name: "Work", collapsed: true, lockable: true }, { id: "other", name: "Other", collapsed: true, lockable: true }]));
  state.verify.mockReset().mockResolvedValue(true); state.create.mockReset().mockResolvedValue(record);
});
afterEach(() => vi.unstubAllGlobals());
async function setup() { const model = await import("./groupLock"); await model.setLockPassword("synthetic-initial"); model.lockAllGroups(); return model; }
const groups = () => JSON.parse(localStorage.getItem("bycoda.projectGroups")!) as { id: string; collapsed: boolean; lockable: boolean }[];
it("wrong passwords keep groups locked while a fresh correct attempt opens only the reviewed group", async () => {
  const model = await setup(); state.verify.mockResolvedValueOnce(false); expect((await model.unlockGroup("work", "synthetic-wrong")).ok).toBe(false);
  expect(model.getGroupLockView().lock.lockedGroupIds.has("work")).toBe(true); expect(groups().find((row) => row.id === "work")?.collapsed).toBe(true);
  expect((await model.unlockGroup("work", "synthetic-correct")).ok).toBe(true); expect(model.getGroupLockView().lock.lockedGroupIds.has("other")).toBe(true);
});
it.each(["replace", "unset"])("a pending unlock cannot apply after its password record is %s", async (change) => {
  const model = await setup(); let finish!: (value: boolean) => void; state.verify.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = model.unlockGroup("work", "synthetic-correct"); model.applyRemoteLockRecord(change === "unset" ? null : nextRecord); finish(true);
  expect((await pending).ok).toBe(false); expect(groups().find((row) => row.id === "work")?.collapsed).toBe(true);
  model.applyRemoteLockRecord(record); expect(model.getGroupLockView().lock.lockedGroupIds.has("work")).toBe(true);
});
it("a changed or removed group invalidates the exact pending group authorization", async () => {
  const model = await setup(); let finish!: (value: boolean) => void; state.verify.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = model.removeGroupLock("work", "synthetic-correct"); const projectGroups = await import("../../projects/model/projectGroups");
  projectGroups.updateProjectGroup("work", (group) => ({ ...group, name: "Changed while verifying" })); finish(true);
  expect((await pending).ok).toBe(false); expect(groups().find((row) => row.id === "work")?.lockable).toBe(true);
});
it("simultaneous successful hashes cannot both apply through the outer-await gap", async () => {
  const model = await setup(); const finishes: ((value: boolean) => void)[] = [];
  state.verify.mockImplementation(() => new Promise((resolve) => { finishes.push(resolve); }));
  const first = model.unlockGroup("work", "synthetic-correct"); const second = model.unlockGroup("other", "synthetic-correct");
  finishes.forEach((finish) => finish(true)); const results = await Promise.all([first, second]);
  expect(results.filter((result) => result.ok)).toHaveLength(1); expect(model.getGroupLockView().lock.lockedGroupIds.size).toBe(1);
});
it("a stale verified hidden-groups request cannot authorize a new record", async () => {
  const model = await setup(); model.hideGroup("work"); let finish!: (value: boolean) => void;
  state.verify.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })); const pending = model.authorizeHiddenGroups("synthetic-correct");
  model.applyRemoteLockRecord(nextRecord); finish(true); expect((await pending).ok).toBe(false); expect(model.getGroupLockView().hiddenGroupsAuthorized).toBe(false);
});
it("a password hash prepared against old privacy state cannot overwrite a concurrently replaced record", async () => {
  const model = await setup(); let finish!: (value: typeof record) => void; state.create.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = model.setLockPassword("synthetic-new"); model.applyRemoteLockRecord(nextRecord); finish(record);
  await expect(pending).rejects.toThrow("Privacy settings changed"); expect(JSON.parse(localStorage.getItem("bycoda.groupLock")!).record).toEqual(nextRecord);
});
it.each([true, false])("stale verification (%s) cannot change the current record's guess counters", async (matches) => {
  const model = await setup(); let finish!: (value: boolean) => void; state.verify.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = model.verifyLockPassword("synthetic-attempt"); model.applyRemoteLockRecord(nextRecord);
  const currentAttempts = JSON.stringify({ failures: 3, blockedUntil: 0 }); localStorage.setItem("bycoda.groupLock.attempts", currentAttempts);
  finish(matches); expect((await pending).ok).toBe(false); expect(localStorage.getItem("bycoda.groupLock.attempts")).toBe(currentAttempts);
});
