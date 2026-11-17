import { afterEach, expect, it } from "vitest";
import { HostStore } from "../store";
import { HostLimits } from "../limits";
import {
  forgetArchivePullRequest,
  hasMergedArchivePullRequest,
  recordArchivePullRequest,
} from "./pull-request-links";
import { readHostAgentDefaults } from "./read-defaults";

const stores: HostStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
});
function setup() {
  const store = new HostStore(":memory:");
  stores.push(store);
  return { store, limits: new HostLimits(store) };
}
it("migrates once, retains Host changes and rejects stale desktop saves", async () => {
  const { limits } = setup();
  expect((await limits.settings()).agentDefaults?.version).toBe(0);
  await limits.save({
    agentDefaults: { keepAwakeWhileAgentsWork: true },
    expectedAgentDefaultsVersion: 0,
    migrateAgentDefaults: true,
  });
  await limits.save({ agentDefaults: { resumeAtReset: false }, expectedAgentDefaultsVersion: 1 });
  const result = await limits.save({
    agentDefaults: { resumeAtReset: true },
    expectedAgentDefaultsVersion: 0,
    migrateAgentDefaults: true,
  });
  expect(result.agentDefaults).toMatchObject({
    version: 2,
    keepAwakeWhileAgentsWork: true,
    resumeAtReset: false,
  });
  await expect(
    limits.save({ agentDefaults: { resumeAtReset: true }, expectedAgentDefaultsVersion: 1 }),
  ).rejects.toThrow("changed");
  expect((await limits.save({ maxRunningTasks: 5 })).agentDefaults).toEqual(result.agentDefaults);
  expect((await readHostAgentDefaults(stores[0]!)).resumeAtReset).toBe(false);
});
it("reads old SQLite rows without losing limits and refuses corrupt durable settings", async () => {
  const { limits, store } = setup();
  await limits.ready;
  await store.db
    .prepare("INSERT INTO host_settings VALUES ('settings', ?)")
    .run(JSON.stringify({ maxRunningTasks: 7, dailyAgentMinutes: 60 }));
  expect(await limits.settings()).toMatchObject({
    maxRunningTasks: 7,
    dailyAgentMinutes: 60,
    agentDefaults: { version: 0 },
  });
  await store.db.prepare("UPDATE host_settings SET value='broken' WHERE key='settings'").run();
  await expect(limits.save({ maxRunningTasks: 2 })).rejects.toThrow(
    "Stored Host settings are invalid",
  );
  expect(
    (await store.db.prepare("SELECT value FROM host_settings WHERE key='settings'").get())?.value,
  ).toBe("broken");
});
it("retains merged links independently of watches and removes only explicitly unlinked evidence", async () => {
  const { store } = setup();
  await recordArchivePullRequest(store, "session", "https://github.com/o/r/pull/1", "OPEN");
  expect(await hasMergedArchivePullRequest(store, "session")).toBe(false);
  await recordArchivePullRequest(store, "session", "https://github.com/o/r/pull/1", "MERGED");
  await recordArchivePullRequest(store, "other", "https://github.com/o/r/pull/2", "MERGED");
  expect(await hasMergedArchivePullRequest(store, "session")).toBe(true);
  await forgetArchivePullRequest(store, "session", "https://github.com/o/r/pull/1");
  expect(await hasMergedArchivePullRequest(store, "session")).toBe(false);
  expect(await hasMergedArchivePullRequest(store, "other")).toBe(true);
  await forgetArchivePullRequest(store, "other");
  expect(await hasMergedArchivePullRequest(store, "other")).toBe(false);
});
it("saves behavior defaults and accepts owner-enabled automatic archive with draft authority", async () => {
  const { limits } = setup();
  const saved = await limits.save({
    agentDefaults: { resumeAtReset: false },
    expectedAgentDefaultsVersion: 0,
  });
  expect(saved.agentDefaults).toMatchObject({
    resumeAtReset: false,
    archiveMergedSessions: false,
    archiveInactiveDays: 0,
  });
  expect(
    (
      await limits.save({
        agentDefaults: { archiveMergedSessions: true },
        expectedAgentDefaultsVersion: 1,
      })
    ).agentDefaults?.archiveMergedSessions,
  ).toBe(true);
  expect(
    (
      await limits.save({
        agentDefaults: { archiveInactiveDays: 7 },
        expectedAgentDefaultsVersion: 2,
      })
    ).agentDefaults?.archiveInactiveDays,
  ).toBe(7);
  // Turning archive off or leaving it unchanged stays allowed.
  await limits.save({
    agentDefaults: { archiveMergedSessions: false, archiveInactiveDays: 0 },
    expectedAgentDefaultsVersion: 3,
  });
});
