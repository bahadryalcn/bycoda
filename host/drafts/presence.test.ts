import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  DraftPresenceRegistry,
  PRESENCE_CLEAN_TTL_MS,
  PRESENCE_PERSIST_INTERVAL_MS,
} from "./presence";
import { createDefaultsAutoArchive } from "../settings-defaults/auto-archive";
import { DEFAULT_AGENT_DEFAULTS } from "../../src/features/tasks/model/hostSettings";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "draft-presence-"));
  directories.push(directory);
  let now = 100_000;
  let devices = ["desktop", "phone"];
  const registry = new DraftPresenceRegistry(
    directory,
    async () => devices,
    () => now,
  );
  const report = (device: string, sessionIds: string[] = [], clientId = device) =>
    registry.report(device, { clientId, sessionIds, complete: true });
  return {
    directory,
    registry,
    report,
    setTime: (value: number) => {
      now = value;
    },
    revokePhone: () => {
      devices = ["desktop"];
    },
  };
}
it("unknown paired clients block, every clean client allows", async () => {
  const { registry, report } = await setup();
  expect(await registry.hasUnsentDraft("s", 1000)).toBeUndefined();
  await report("desktop");
  expect(await registry.hasUnsentDraft("s", 1000)).toBeUndefined();
  await report("phone");
  expect(await registry.hasUnsentDraft("s", 1000)).toBe(false);
});
it("any draft blocks, snapshots replace idempotently, revoked devices stop blocking", async () => {
  const { registry, report, revokePhone } = await setup();
  await report("desktop");
  await report("phone", ["s", "s"]);
  expect(await registry.hasUnsentDraft("s", 1000)).toBe(true);
  await report("phone");
  await report("phone");
  expect(await registry.hasUnsentDraft("s", 1000)).toBe(false);
  await report("phone", ["s"]);
  revokePhone();
  expect(await registry.hasUnsentDraft("s", 1000)).toBe(false);
  await expect(report("phone")).rejects.toThrow("revoked");
});
it("stale or future reports block and one window cannot clear another", async () => {
  const { registry, report, setTime } = await setup();
  await report("desktop", ["s"], "window-one");
  await report("desktop", [], "window-two");
  await report("phone");
  expect(await registry.hasUnsentDraft("s", 1000)).toBe(true);
  await report("desktop", [], "window-one");
  setTime(101_000);
  expect(await registry.hasUnsentDraft("s", 1000)).toBeUndefined();
  setTime(99_000);
  expect(await registry.hasUnsentDraft("s", 1000)).toBeUndefined();
});
it("restart retains snapshots; corrupt state fails closed without replacement", async () => {
  const { directory, report } = await setup();
  await report("desktop");
  await report("phone", ["s"]);
  const restarted = new DraftPresenceRegistry(
    directory,
    async () => ["desktop", "phone"],
    () => 100_000,
  );
  expect(await restarted.hasUnsentDraft("s", 1000)).toBe(true);
  expect(await restarted.hasUnsentDraft("clean", 1000)).toBe(false);
  await writeFile(join(directory, "presence.json"), "broken");
  const corrupt = new DraftPresenceRegistry(directory, async () => ["desktop"]);
  expect(await corrupt.hasUnsentDraft("s", 1000)).toBeUndefined();
  await expect(
    corrupt.report("desktop", { clientId: "desktop", sessionIds: [], complete: true }),
  ).rejects.toThrow("invalid");
});
it("rejects partial, oversized and malformed reports", async () => {
  const { registry } = await setup();
  for (const value of [
    { clientId: "x", sessionIds: [], complete: false },
    { clientId: "x", sessionIds: Array(10_001).fill("s"), complete: true },
    { clientId: "x", sessionIds: [""], complete: true },
  ])
    await expect(registry.report("desktop", value)).rejects.toThrow();
});
it("archive tick integrates authority and archives only clean sessions reversibly", async () => {
  const { registry, report, setTime } = await setup();
  const archived: string[] = [];
  const engine = {
    store: {
      projects: async () => [{ id: "p" }],
      summaries: async () => ["draft", "clean"].map((id) => ({ id, status: "idle" })),
      session: async (id: string) => ({
        id,
        status: "idle",
        lastActivityAt: 1,
        authorityGeneration: 1,
        session: { blocks: [] },
      }),
      updateSession: async (id: string, patch: unknown) => {
        expect(patch).toEqual({ archived: true });
        archived.push(id);
      },
    },
    sessionStoreWrite: async (_id: string, run: () => Promise<void>) => run(),
  };
  const archive = createDefaultsAutoArchive({
    engine: engine as never,
    limits: {
      settings: async () => ({
        agentDefaults: { ...DEFAULT_AGENT_DEFAULTS, archiveInactiveDays: 1 },
      }),
    } as never,
    queued: async () => false,
    running: async () => false,
    hasUnsentDraft: (id, windowMs) => registry.hasUnsentDraft(id, windowMs),
    now: () => 10 * 86_400_000,
  });
  expect(await archive.tick()).toBe(0);
  await report("desktop");
  await report("phone", ["draft"]);
  expect(await archive.tick()).toBe(1);
  expect(archived).toEqual(["clean"]);
  setTime(100_000 + 86_400_000);
  expect(await archive.tick()).toBe(0);
});
async function stored(directory: string): Promise<{ clientId: string; reportedAt: number }[]> {
  return JSON.parse(await readFile(join(directory, "presence.json"), "utf8"));
}
it("unchanged heartbeats stay in memory and the file refreshes only at the coarse interval", async () => {
  const { directory, registry, report, setTime } = await setup();
  await report("desktop");
  await report("phone", ["s"]);
  const first = await readFile(join(directory, "presence.json"), "utf8");
  setTime(130_000);
  await report("desktop");
  await report("phone", ["s"]);
  expect(await readFile(join(directory, "presence.json"), "utf8")).toBe(first);
  // Memory still carries the fresh timestamp, so clean sessions stay archivable.
  expect(await registry.hasUnsentDraft("clean", 60_000)).toBe(false);
  expect(await registry.hasUnsentDraft("s", 60_000)).toBe(true);
  setTime(100_000 + PRESENCE_PERSIST_INTERVAL_MS);
  await report("desktop");
  expect((await stored(directory)).find((row) => row.clientId === "desktop")?.reportedAt).toBe(
    100_000 + PRESENCE_PERSIST_INTERVAL_MS,
  );
  // A changed session set persists immediately, between intervals.
  await report("phone", ["s", "t"]);
  expect(await stored(directory)).toHaveLength(2);
  expect(await readFile(join(directory, "presence.json"), "utf8")).toContain('"t"');
});
it("prunes expired clean clients but never expired draft-bearing ones or fresh ownership", async () => {
  const { directory, registry, report, setTime } = await setup();
  await report("phone", [], "leaked-install");
  await report("phone", ["draft"], "offline-window");
  await report("phone", [], "phone");
  await report("desktop");
  setTime(100_000 + PRESENCE_CLEAN_TTL_MS);
  // Leaked clean rows no longer pin the answer to "unknown" even before a pruning write.
  await report("phone", [], "phone");
  expect(await registry.hasUnsentDraft("clean", PRESENCE_CLEAN_TTL_MS * 2)).toBeUndefined();
  await report("desktop");
  const ids = (await stored(directory)).map((row) => row.clientId).sort();
  expect(ids).toEqual(["desktop", "offline-window", "phone"]);
  expect(await registry.hasUnsentDraft("draft", 1000)).toBe(true);
});
it("a leaked client id cannot exhaust the cap once it expires", async () => {
  const { directory } = await setup();
  const rows = Array.from({ length: 4096 }, (_, index) => ({
    deviceId: "phone",
    clientId: `old-${index}`,
    sessionIds: [],
    reportedAt: 1,
  }));
  await writeFile(join(directory, "presence.json"), JSON.stringify(rows));
  const registry = new DraftPresenceRegistry(
    directory,
    async () => ["desktop", "phone"],
    () => PRESENCE_CLEAN_TTL_MS + 10,
  );
  await expect(
    registry.report("desktop", { clientId: "desktop", sessionIds: [], complete: true }),
  ).resolves.toEqual({ accepted: true });
  expect(await stored(directory)).toHaveLength(1);
});
