import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostDomainContext } from "../context";
import { createSessionLifecycleService, type SessionActivity } from "./lifecycle-service";
import { normalizeLifecycleRecord, SessionLifecycleStore } from "../../sessions/lifecycle-store";

const DAY = 86_400_000;
const NOW = 100 * DAY;

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const context: HostDomainContext = { authorized: async () => true };

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "lifecycle-"));
  dirs.push(dir);
  const state = { exists: true, running: false, queued: 0, rows: [] as SessionActivity[] };
  const ports = {
    runState: vi.fn(async () => ({
      exists: state.exists,
      running: state.running,
      queued: state.queued,
    })),
    activity: vi.fn(async () => state.rows),
    archive: vi.fn(async (_sessionId: string) => undefined),
    now: () => NOW,
  };
  let now = NOW;
  ports.now = () => now;
  const make = () => createSessionLifecycleService(new SessionLifecycleStore(dir), ports);
  const at = (time: number) => {
    now = time;
  };
  return { state, ports, make, at, service: make() };
}

const idle = (sessionId: string, daysAgo: number, extra: Partial<SessionActivity> = {}) => ({
  sessionId,
  lastActivityAt: NOW - daysAgo * DAY,
  pinned: false,
  archived: false,
  running: false,
  needsInput: false,
  ...extra,
});

it("settles an idle session at once and lists it", async () => {
  const { service } = await fixture();
  expect(await service.settle("s", context)).toMatchObject({
    state: "settled",
    settledAt: NOW,
    settledBy: "owner",
  });
  expect((await service.list()).map((record) => record.sessionId)).toEqual(["s"]);
});

it("settling a running session waits for the turn and never stops it", async () => {
  const { service, state } = await fixture();
  state.running = true;
  expect((await service.settle("s", context)).state).toBe("settling");
  expect((await service.turnEnded("s")).state).toBe("settling");
  state.running = false;
  expect((await service.turnEnded("s")).state).toBe("settled");
});

it("a failed turn or a queued follow-up leaves a pending settle active", async () => {
  const { service, state } = await fixture();
  state.running = true;
  await service.settle("a", context);
  await service.settle("b", context);
  state.running = false;
  expect((await service.turnEnded("a", { error: "boom" })).state).toBe("active");
  state.queued = 1;
  expect((await service.turnEnded("b")).state).toBe("active");
});

it("a new message wakes a settled session and clears an un-settle hold", async () => {
  const { service } = await fixture();
  await service.settle("s", context);
  expect((await service.wake("s")).state).toBe("active");
  expect(await service.list()).toEqual([]);
  expect((await service.unsettle("s", context)).keepActive).toBe(true);
  expect((await service.wake("s")).keepActive).toBeUndefined();
});

it("a pending settle survives a Host restart and applies on recovery", async () => {
  const { service, state, make } = await fixture();
  state.running = true;
  await service.settle("s", context);
  state.running = false;
  const restarted = make();
  expect(await restarted.recover()).toBe(1);
  expect((await restarted.get("s")).state).toBe("settled");
});

it("auto-settles only idle sessions past the window", async () => {
  const { service, state } = await fixture();
  state.rows = [
    idle("old", 4),
    idle("recent", 1),
    idle("pinned", 9, { pinned: true }),
    idle("archived", 9, { archived: true }),
    idle("running", 9, { running: true }),
    idle("asking", 9, { needsInput: true }),
    idle("held", 9),
  ];
  await service.unsettle("held", context);
  expect(await service.autoSettle()).toBe(1);
  expect(await service.list()).toMatchObject([{ sessionId: "old", settledBy: "auto" }]);
});

it("auto-settle skips queued sessions and can be turned off", async () => {
  const { service, state } = await fixture();
  state.rows = [idle("s", 9)];
  state.queued = 2;
  expect(await service.autoSettle()).toBe(0);
  state.queued = 0;
  expect(await service.configure({ afterDays: null }, context)).toEqual({
    afterDays: null,
    archiveAfterDays: null,
  });
  expect(await service.autoSettle()).toBe(0);
  await service.configure({ afterDays: 7 }, context);
  expect(await service.autoSettle()).toBe(1);
});

it("rejects an unknown session and an unauthorized caller", async () => {
  const { service, state } = await fixture();
  const denied = { authorized: async () => false };
  await expect(service.settle("s", denied)).rejects.toThrow(/revoked/);
  await expect(service.unsettle("s", denied)).rejects.toThrow(/revoked/);
  await expect(service.configure({ afterDays: 1 }, denied)).rejects.toThrow(/revoked/);
  state.exists = false;
  await expect(service.settle("s", context)).rejects.toThrow(/not found/);
});

it("never touches pin or tasks, and archives only through opt-in automatic archiving", async () => {
  const { ports, service, state } = await fixture();
  expect(Object.keys(ports).some((key) => /pin|task/i.test(key))).toBe(false);
  state.rows = [idle("s", 400)];
  await service.settle("s", context);
  await service.autoSettle();
  expect(await service.autoArchive()).toBe(0);
  expect(ports.archive).not.toHaveBeenCalled();
});

it("a settings change without an archive window keeps the saved one", async () => {
  const { service } = await fixture();
  await service.configure({ afterDays: 3, archiveAfterDays: 14 }, context);
  expect(await service.configure({ afterDays: 7 }, context)).toEqual({
    afterDays: 7,
    archiveAfterDays: 14,
  });
  expect(await service.configure({ afterDays: 7, archiveAfterDays: null }, context)).toEqual({
    afterDays: 7,
    archiveAfterDays: null,
  });
  await expect(
    service.configure({ afterDays: 1, archiveAfterDays: 7 }, { authorized: async () => false }),
  ).rejects.toThrow(/revoked/);
});

it("auto-archives only sessions settled past the archive window", async () => {
  const { service, state, ports, at } = await fixture();
  state.rows = [
    idle("old", 40),
    idle("fresh", 40),
    idle("active", 40),
    idle("pinned", 40, { pinned: true }),
    idle("running", 40, { running: true }),
    idle("woken", 1),
  ];
  at(NOW - 20 * DAY);
  for (const id of ["old", "pinned", "running", "woken"]) await service.settle(id, context);
  at(NOW - 2 * DAY);
  await service.settle("fresh", context);
  at(NOW);
  await service.configure({ afterDays: null, archiveAfterDays: 14 }, context);
  expect(await service.autoArchive()).toBe(1);
  expect(ports.archive.mock.calls).toEqual([["old"]]);
});

it("auto-archive skips queued and already archived sessions and can be turned off", async () => {
  const { service, state, ports, at } = await fixture();
  state.rows = [idle("s", 40), idle("done", 40, { archived: true })];
  at(NOW - 30 * DAY);
  await service.settle("s", context);
  await service.settle("done", context);
  at(NOW);
  await service.configure({ afterDays: null, archiveAfterDays: 7 }, context);
  state.queued = 1;
  expect(await service.autoArchive()).toBe(0);
  state.queued = 0;
  await service.configure({ afterDays: null, archiveAfterDays: null }, context);
  expect(await service.autoArchive()).toBe(0);
  expect(ports.archive).not.toHaveBeenCalled();
});

it("migrates rows from the close model and defaults participants", () => {
  expect(normalizeLifecycleRecord("s", { state: "closed", closedAt: 5 }, null)).toEqual({
    sessionId: "s",
    participants: [{ userId: null, role: "owner" }],
    state: "settled",
    settledAt: 5,
    settledBy: "owner",
  });
  expect(
    normalizeLifecycleRecord("s", { state: "closing", closing: { requestedAt: 7 } }),
  ).toMatchObject({ state: "settling", settleRequestedAt: 7 });
  expect(normalizeLifecycleRecord("s", { state: "closing" }).state).toBe("active");
  expect(normalizeLifecycleRecord("s", { state: "open", reopenedAt: 3 }).state).toBe("active");
  expect(normalizeLifecycleRecord("s", {}, "user_1").participants).toEqual([
    { userId: "user_1", role: "owner" },
  ]);
});
