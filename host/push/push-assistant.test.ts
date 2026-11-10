import { afterEach, describe, expect, it } from "vitest";
import type { AssistantNotification } from "../../src/shared/model/host-contracts/assistant";
import { StoreDatabase } from "../store-db";
import type { ExpoPushMessage } from "./expo-push";
import { AssistantPushLedger } from "./push-assistant";
import { PushNotifications } from "./push-service";
import { parsePushRegistration, PushDeviceStore } from "./push-store";

const registration = {
  pushToken: "ExponentPushToken[abcdefghij123]",
  platform: "android",
  title: "bycoda · Home PC",
  texts: { finished: "Agent finished", input: "Needs your input", failed: "Turn failed" },
  events: { finished: true, input: true, failed: true },
};

const databases: StoreDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close();
});

function notification(
  id: string,
  kind: AssistantNotification["kind"],
  over: Partial<AssistantNotification> = {},
): AssistantNotification {
  return {
    id,
    kind,
    title: "Title",
    body: "Body",
    createdAt: 1,
    eligible: true,
    deferredReason: null,
    ...over,
  };
}

async function setup(settings: Record<string, unknown> = {}) {
  const db = new StoreDatabase(":memory:");
  databases.push(db);
  await db.exec(
    "CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE)",
  );
  await db.prepare("INSERT INTO devices VALUES (?, ?, ?)").run("phone", "phone", "phone");
  const store = new PushDeviceStore(db);
  await store.register("phone", parsePushRegistration({ ...registration, ...settings }));
  let pending: AssistantNotification[] = [];
  const sent: ExpoPushMessage[] = [];
  const create = () =>
    new PushNotifications({
      store,
      environmentId: "env-1",
      sessions: async () => [],
      assistant: async () => pending,
      assistantLedger: new AssistantPushLedger(db),
      send: async (messages) => {
        sent.push(...messages);
        return { unregistered: [], failed: 0 };
      },
    });
  return { db, store, sent, create, set: (items: AssistantNotification[]) => (pending = items) };
}

describe("assistant pushes", () => {
  it("sends once per notification and phone, with data for a deep link", async () => {
    const t = await setup();
    const service = t.create();
    t.set([notification("n1", "job.done", { jobId: "j1", body: "x".repeat(500) })]);
    await service.tick();
    await service.tick();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].title).toBe("Title");
    expect(t.sent[0].body).toHaveLength(200);
    expect(t.sent[0].data).toEqual({
      kind: "assistant",
      notificationId: "n1",
      assistantKind: "job.done",
      environmentId: "env-1",
      jobId: "j1",
    });
  });

  it("does not repeat after a Host restart", async () => {
    const t = await setup();
    t.set([notification("n1", "job.done")]);
    await t.create().tick();
    await t.create().tick();
    expect(t.sent).toHaveLength(1);
  });

  it("sends nothing while the desktop is in use", async () => {
    const t = await setup();
    const service = t.create();
    service.desktopPresence("window", true);
    t.set([notification("n1", "job.done")]);
    await service.tick();
    expect(t.sent).toEqual([]);
    service.desktopPresence("window", false);
    await service.tick();
    expect(t.sent).toHaveLength(1);
  });

  it("holds ineligible notifications, but lets urgent ones through quiet hours", async () => {
    const t = await setup();
    const quiet = { eligible: false, deferredReason: "quiet" as const };
    t.set([
      notification("calm", "job.done", quiet),
      notification("urgent", "job.failed", quiet),
      notification("away", "job.failed", { eligible: false, deferredReason: "away" }),
    ]);
    await t.create().tick();
    expect(t.sent.map((m) => m.data.notificationId)).toEqual(["urgent"]);
  });

  it("keeps urgent notifications quiet when the phone opted out", async () => {
    const t = await setup({ assistantUrgentDuringQuiet: false });
    t.set([notification("u", "owner.question", { eligible: false, deferredReason: "quiet" })]);
    await t.create().tick();
    expect(t.sent).toEqual([]);
  });

  it("sends nothing to a phone with assistant pushes off", async () => {
    const t = await setup({ events: { ...registration.events, assistant: false } });
    t.set([notification("n1", "job.failed")]);
    await t.create().tick();
    expect(t.sent).toEqual([]);
  });

  it("reads records stored before the assistant setting existed as on", async () => {
    const t = await setup();
    const row = await t.db.prepare("SELECT settings FROM push_devices").get();
    const old = JSON.parse(String(row?.settings));
    delete old.assistantUrgentDuringQuiet;
    delete old.events.assistant;
    delete old.texts.assistant;
    await t.db.prepare("UPDATE push_devices SET settings=?").run(JSON.stringify(old));
    const [recipient] = await t.store.recipients();
    expect(recipient.events.assistant).toBe(true);
    expect(recipient.assistantUrgentDuringQuiet).toBe(true);
    expect(recipient.texts.assistant).toBeTruthy();
  });
});
