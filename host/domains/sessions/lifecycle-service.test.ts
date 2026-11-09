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
    now: () => NOW,
  };
  const make = () => createSessionLifecycleService(new SessionLifecycleStore(dir), ports);
  return { state, ports, make, service: make() };
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
  expect(await service.configure({ afterDays: null }, context)).toEqual({ afterDays: null });
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

it("never touches archive, pin or tasks", async () => {
  const { ports } = await fixture();
  expect(Object.keys(ports).some((key) => /archive|pin|task/i.test(key))).toBe(false);
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
