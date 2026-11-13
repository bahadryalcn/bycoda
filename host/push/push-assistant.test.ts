import { afterEach, describe, expect, it, vi } from "vitest";
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
  let wallTime = 1000;
  const sent: ExpoPushMessage[] = [];
  const create = (overrides: Partial<ConstructorParameters<typeof PushNotifications>[0]> = {}) =>
    new PushNotifications({
      store,
      environmentId: "env-1",
      sessions: async () => [],
      assistant: async () => pending,
      assistantLedger: new AssistantPushLedger(db),
      wallNow: () => wallTime,
      send: async (messages) => {
        sent.push(...messages);
        return { unregistered: [], failed: 0 };
      },
      ...overrides,
    });
  return {
    db,
    store,
    sent,
    create,
    advance: (milliseconds: number) => {
      wallTime += milliseconds;
    },
    set: (items: AssistantNotification[]) => (pending = items),
  };
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

  it("keeps the phone channel active while the desktop is in use", async () => {
    const t = await setup();
    const service = t.create();
    service.desktopPresence("window", true);
    t.set([notification("n1", "job.done")]);
    await service.tick();
    expect(t.sent).toHaveLength(1);
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

it("reserves two urgent reminders thirty minutes apart and survives restart", async () => {
  const t = await setup();
  const item = notification("urgent-repeat", "job.failed");
  const ledger = new AssistantPushLedger(t.db);
  expect(await ledger.reserve("phone", item, 1000)).toBe(0);
  expect(await ledger.reserve("phone", item, 1000)).toBeNull();
  await ledger.accept("phone", item.id, 0);
  const restart = new AssistantPushLedger(t.db);
  expect(await restart.reserve("phone", item, 1000 + 29 * 60000)).toBeNull();
  expect(await restart.reserve("phone", item, 1000 + 30 * 60000)).toBe(1);
  await restart.accept("phone", item.id, 1);
  expect(await restart.reserve("phone", item, 1000 + 60 * 60000)).toBe(2);
  await restart.accept("phone", item.id, 2);
  expect(await restart.reserve("phone", item, 1000 + 90 * 60000)).toBeNull();
});

it("never replays an occurrence or schedules a reminder after a lost receipt", async () => {
  const t = await setup();
  const item = notification("unknown-receipt", "owner.question");
  expect(await new AssistantPushLedger(t.db).reserve("phone", item, 1000)).toBe(0);
  expect(await new AssistantPushLedger(t.db).reserve("phone", item, 1000 + 60 * 60000)).toBeNull();
});

it("honors disabled reminders and stops after acknowledgement removes the pending item", async () => {
  const t = await setup();
  const item = notification("ack", "owner.question", { repeatCount: 0 });
  const ledger = new AssistantPushLedger(t.db);
  expect(await ledger.reserve("phone", item, 1000)).toBe(0);
  await ledger.accept("phone", item.id, 0);
  expect(await ledger.reserve("phone", item, 1000 + 60 * 60000)).toBeNull();
  t.set([notification("ack-pending", "owner.question")]);
  const service = t.create();
  await service.tick();
  t.advance(30 * 60000);
  t.set([]);
  await service.tick();
  expect(t.sent).toHaveLength(1);
});

it("dispatches reminders after restart only while the same notification is pending", async () => {
  const t = await setup();
  t.set([notification("repeat-pending", "owner.question")]);
  await t.create().tick();
  t.advance(29 * 60000);
  await t.create().tick();
  expect(t.sent).toHaveLength(1);
  t.advance(60000);
  await t.create().tick();
  expect(t.sent).toHaveLength(2);
  t.advance(30 * 60000);
  await t.create().tick();
  expect(t.sent).toHaveLength(3);
  t.advance(30 * 60000);
  await t.create().tick();
  expect(t.sent).toHaveLength(3);
});

it("keeps a send with a lost receipt unknown across restart", async () => {
  const t = await setup();
  t.set([notification("lost-send", "owner.question")]);
  await expect(
    t
      .create({
        send: async () => {
          throw new Error("receipt lost");
        },
      })
      .tick(),
  ).rejects.toThrow("receipt lost");
  t.advance(60 * 60000);
  await t.create().tick();
  expect(t.sent).toEqual([]);
});

it("ticks configured Telegram with no paired phones", async () => {
  const t = await setup();
  await t.db.prepare("DELETE FROM push_devices").run();
  const telegram = vi.fn(async () => {});
  await t.create({ telegram }).tick();
  expect(telegram).toHaveBeenCalledOnce();
});

it("keeps mobile delivery working when the Telegram channel is unavailable", async () => {
  const t = await setup();
  t.set([notification("mobile-independent", "owner.question")]);
  await t
    .create({
      telegram: async () => {
        throw new Error("Native unavailable");
      },
    })
    .tick();
  expect(t.sent).toHaveLength(1);
});

it("retains the original Native source envelope across ledger recreation and known-zero retry", async () => {
  const t = await setup();
  const ledger = new AssistantPushLedger(t.db);
  const source = {
    environmentId: "host",
    threadId: "original-room",
    operationId: "occurrence",
    action: "social.send" as const,
    input: { snapshotHash: "original" },
  };
  await ledger.saveOperation("telegram", "notification", 0, source);
  const restarted = new AssistantPushLedger(t.db);
  await restarted.saveOperation("telegram", "notification", 0, {
    ...source,
    threadId: "replacement-room",
    input: { snapshotHash: "changed" },
  });
  expect(await restarted.operation("telegram", "notification", 0)).toEqual(source);
});
