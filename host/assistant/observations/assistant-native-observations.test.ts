import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../../store";
import { AssistantObservationJournal } from "./assistant-observation-journal";
import { ingestNativeObservations } from "./assistant-native-observations";

it("commits exact native identities once and defers unknown scopes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "native-observations-"));
  const store = new HostStore(join(dir, "host.db"));
  try {
    await store.ready;
    const journal = new AssistantObservationJournal(store);
    const item = { sequence: 1, sourceId: "note", revision: 1, change: "created", sourceCwd: "/project", occurredAt: 123 };
    const operation = { hostId: store.environmentId, installationId: "native-one", source: "note", entries: [item, { ...item, sequence: 2, sourceId: "personal", sourceCwd: null }] };
    let allowed = true;
    const options = { store, journal, operation, verifiedHostId: store.environmentId, verifiedInstallationId: "native-one", valid: () => allowed,
      resolve: async (cwd: string) => cwd === "/project" ? { projectId: "project", valid: () => allowed } : null };
    const first = await ingestNativeObservations(options);
    expect(first.receipts).toMatchObject([{ sequence: 1, sourceId: "note", revision: 1 }]);
    expect(first.deferred).toEqual([2]);
    expect(await ingestNativeObservations(options)).toEqual(first);
    const page = await journal.read("room", { projectId: "project" }, async () => true, async () => true, () => true);
    expect(page.events).toHaveLength(1);
    expect(JSON.stringify(page)).not.toContain("/project");
    await journal.pruneBefore(first.receipts[0]!.journalSequence);
    expect(await ingestNativeObservations(options)).toEqual(first);
    expect(Number((await store.db.prepare("SELECT COUNT(*) AS count FROM assistant_observation_events").get())!.count)).toBe(0);
    allowed = false;
    await expect(ingestNativeObservations(options)).rejects.toThrow("authority changed");
    await expect(ingestNativeObservations({ ...options, valid: () => true, verifiedInstallationId: "other" })).rejects.toThrow("authority changed");
  } finally { await store.close(); rmSync(dir, { recursive: true, force: true }); }
});

it("rolls back the whole batch if a captured scope is revoked during append", async () => {
  const dir = mkdtempSync(join(tmpdir(), "native-observation-revoke-"));
  const store = new HostStore(join(dir, "host.db"));
  try {
    await store.ready;
    const journal = new AssistantObservationJournal(store);
    let checks = 0;
    const entries = [1, 2].map(sequence => ({ sequence, sourceId: `n${sequence}`, revision: 1, change: "created", sourceCwd: "/project", occurredAt: 123 }));
    await expect(ingestNativeObservations({ store, journal, operation: { hostId: store.environmentId, installationId: "native-one", source: "note", entries },
      verifiedHostId: store.environmentId, verifiedInstallationId: "native-one", valid: () => true,
      resolve: async () => ({ projectId: "project", valid: () => ++checks < 5 }),
    })).rejects.toThrow("scope changed");
    const page = await journal.read("room", { projectId: "project" }, async () => true, async () => true, () => true);
    expect(page.events).toEqual([]);
  } finally { await store.close(); rmSync(dir, { recursive: true, force: true }); }
});

it("stores personal notes under verified Native installation only with live owner capture", async () => {
  const dir = mkdtempSync(join(tmpdir(), "native-personal-observations-"));
  const store = new HostStore(join(dir, "host.db"));
  try {
    await store.ready;
    const journal = new AssistantObservationJournal(store);
    const operation = { hostId: store.environmentId, installationId: "native-one", source: "note", entries: [{ sequence: 1, sourceId: "n", revision: 1, change: "created", sourceCwd: null, occurredAt: 123 }] };
    const options = { store, journal, operation, verifiedHostId: store.environmentId, verifiedInstallationId: "native-one", valid: () => true, resolve: async () => null };
    expect((await ingestNativeObservations(options)).deferred).toEqual([1]);
    const saved = await ingestNativeObservations({ ...options, resolvePersonal: async () => ({ valid: () => true }) });
    expect(saved.receipts).toHaveLength(1);
    const read = (nativeInstallationId: string) => journal.read("room", { nativeInstallationId }, async () => true, async () => true, () => true);
    expect((await read("native-one")).events).toMatchObject([{ nativeInstallationId: "native-one", projectIds: [] }]);
    expect((await read("native-two")).events).toEqual([]);
    expect((await journal.read("room", { projectId: "p" }, async () => true, async () => true, () => true)).events).toEqual([]);
    expect((await journal.read("room", { accountId: "a" }, async () => true, async () => true, () => true)).events).toEqual([]);
    const server = { ...operation, source: "server" };
    expect((await ingestNativeObservations({ ...options, operation: server, resolvePersonal: async () => ({ valid: () => true }) })).receipts).toHaveLength(1);
    expect((await read("native-one")).events.map(item => item.source)).toEqual(["note", "server"]);
    await expect(ingestNativeObservations({ ...options, operation: { ...server, entries: [{ ...server.entries[0], sourceCwd: "/project" }] }, resolvePersonal: async () => ({ valid: () => true }) })).rejects.toThrow("cannot claim a project");
    const session = { ...operation, source: "native-session", entries: [{ ...operation.entries[0], sourceCwd: "/project" }] };
    await expect(ingestNativeObservations({ ...options, operation: session })).resolves.toMatchObject({ deferred: [1] });
    await expect(ingestNativeObservations({ ...options, operation: session, resolve: async () => ({ projectId: "p", valid: () => true }) })).resolves.toMatchObject({ receipts: [{ sourceId: "n" }] });
    expect((await journal.read("room", { projectId: "p" }, async () => true, async () => true, () => true)).events).toMatchObject([{ source: "native-session", projectIds: ["p"] }]);
    const otherSession = { ...session, installationId: "native-two" };
    await ingestNativeObservations({ ...options, operation: otherSession, verifiedInstallationId: "native-two", resolve: async () => ({ projectId: "p", valid: () => true }) });
    const filtered = await journal.read("qualified", { projectId: "p" }, async () => true, async () => true, () => true, 50, 32768, "native-session", "native-one");
    expect(filtered.events).toHaveLength(1);
    expect(filtered.events[0].producerInstallationId).toBe("native-one");
  } finally { await store.close(); rmSync(dir, { recursive: true, force: true }); }
});
