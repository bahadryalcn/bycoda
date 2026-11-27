import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantNotification } from "../../src/shared/model/host-contracts/assistant";
import { StoreDatabase } from "../store-db";
import type { ExpoPushMessage } from "./expo-push";
import { AssistantPushLedger } from "./push-assistant";
import { PushNotifications } from "./push-service";
import { parsePushRegistration, PushDeviceStore } from "./push-store";

const registration = {
  platform: "android",
  title: "bycoda · Home PC",
  texts: { finished: "Agent finished", input: "Needs your input", failed: "Turn failed" },
  events: { finished: true, input: true, failed: true, assistant: true },
};

const databases: StoreDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close();
});

function notification(id: string): AssistantNotification {
  return {
    id,
    kind: "job.done",
    title: "Title",
    body: "Body",
    createdAt: 1,
    eligible: true,
    deferredReason: null,
  };
}

async function setup(phoneHashes: string[]) {
  const db = new StoreDatabase(":memory:");
  databases.push(db);
  await db.exec(
    "CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE)",
  );
  const store = new PushDeviceStore(db);
  for (const [index, hash] of phoneHashes.entries()) {
    await db.prepare("INSERT INTO devices VALUES (?, ?, ?)").run(hash, hash, hash);
    await store.register(
      hash,
      parsePushRegistration({
        ...registration,
        pushToken: `ExponentPushToken[phone${index}abcdef123]`,
      }),
    );
  }
  const recipientsSpy = vi.spyOn(store, "recipients");
  let clock = 1_000;
  let pending: AssistantNotification[] = [];
  const assistant = vi.fn(async () => pending);
  const sent: ExpoPushMessage[] = [];
  const create = (send?: (messages: readonly ExpoPushMessage[]) => Promise<void>) =>
    new PushNotifications({
      store,
      environmentId: "env-1",
      sessions: async () => [],
      assistant,
      assistantLedger: new AssistantPushLedger(db),
      wallNow: () => 1_000,
      now: () => clock,
      send: async (messages) => {
        sent.push(...messages);
        await send?.(messages);
        return { unregistered: [], failed: 0 };
      },
    });
  return {
    service: create(),
    create,
    assistant,
    recipientsSpy,
    sent,
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
    set: (items: AssistantNotification[]) => {
      pending = items;
    },
  };
}

describe("assistant push tick reads", () => {
  it("reads pending items once per tick, not once per phone and item", async () => {
    const t = await setup(["phone-a", "phone-b"]);
    t.set([notification("n1"), notification("n2"), notification("n3")]);
    await t.service.tick();
    expect(t.sent).toHaveLength(6);
    expect(t.assistant).toHaveBeenCalledTimes(1);
    // The tick's own recipient list read is the only unscoped read; no per-device lookup in the send loop.
    const perDevice = t.recipientsSpy.mock.calls.filter(([deviceHash]) => deviceHash !== undefined);
    expect(perDevice).toEqual([]);
  });

  it("re-reads and stops a send once an acknowledgement lands after the recheck age", async () => {
    const t = await setup(["phone-a"]);
    t.set([notification("first"), notification("acked")]);
    // The first send takes long enough that the view is stale; the owner acknowledges the second meanwhile.
    const service = t.create(async () => {
      t.advance(2_000);
      t.set([notification("first")]);
    });
    await service.tick();
    expect(t.sent.map((m) => m.data.notificationId)).toEqual(["first"]);
    expect(t.assistant).toHaveBeenCalledTimes(2);
  });

  it("keeps using a fresh view without re-reading while it is within the recheck age", async () => {
    const t = await setup(["phone-a"]);
    t.set([notification("first"), notification("second")]);
    // Sends are instant, so the single tick read stays fresh and nothing is re-read between them.
    await t.service.tick();
    expect(t.sent.map((m) => m.data.notificationId)).toEqual(["first", "second"]);
    expect(t.assistant).toHaveBeenCalledTimes(1);
  });
});
