import { afterEach, describe, expect, it } from "vitest";
import { ownerApprovalSignature } from "../../src/shared/model/ownerApprovalSignature";
import { ApprovalRegistry } from "../approvals/approval-registry";
import { StoreDatabase } from "../store-db";
import type { HostSessionSummary } from "../../src/features/connections/model/protocol";
import { ExpoPushError, type ExpoPushMessage, type ExpoPushResult } from "./expo-push";
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

async function setup(settings: Record<string, unknown> = {}) {
  const db = new StoreDatabase(":memory:");
  databases.push(db);
  await db.exec(
    "CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE)",
  );
  await db.prepare("INSERT INTO devices VALUES (?, ?, ?)").run("phone", "phone", "phone");
  const store = new PushDeviceStore(db);
  await store.register("phone", parsePushRegistration({ ...registration, ...settings }));
  const approvals = new ApprovalRegistry();
  approvals.noteDesktop("desk");
  const sent: ExpoPushMessage[] = [];
  /** Tests replace `send` to simulate Expo failing; `sessions` feeds conversation events. */
  const control = {
    sessions: [] as HostSessionSummary[],
    send: undefined as
      | undefined
      | ((messages: readonly ExpoPushMessage[]) => Promise<ExpoPushResult>),
  };
  const service = new PushNotifications({
    store,
    approvals,
    environmentId: "env-1",
    sessions: async () => control.sessions,
    send: async (messages) => {
      if (control.send) return control.send(messages);
      sent.push(...messages);
      return { unregistered: [], failed: 0 };
    },
  });
  const add = async (id: string, remote = true) => {
    const item = {
      id,
      title: "Secret project name",
      message: "Delete everything in Acme",
      confirmLabel: "Yes",
      cancelLabel: "No",
      deadline: Date.now() + 200_000,
      remote,
    };
    await approvals.mirror("desk", {
      upsert: [{ ...item, signature: await ownerApprovalSignature(item) }],
      remove: [],
    });
  };
  return { db, store, approvals, sent, service, add, control };
}

const outage = (messages: readonly ExpoPushMessage[]) =>
  new ExpoPushError("Expo push rejected the request (429)", {
    unregistered: [],
    failed: 0,
    retry: [...messages],
  });

describe("approval pushes", () => {
  it("pushes a new remote approval once, without its content", async () => {
    const t = await setup();
    await t.add("a");
    await t.service.tick();
    await t.service.tick();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].data).toEqual({ kind: "approval", approvalId: "a", environmentId: "env-1" });
    expect(JSON.stringify(t.sent[0])).not.toContain("Acme");
  });

  it("sends a burst of approvals across ticks, at most three per tick", async () => {
    const t = await setup();
    for (const id of ["a", "b", "c", "d", "e"]) await t.add(id);
    await t.service.tick();
    expect(t.sent).toHaveLength(3);
    await t.service.tick();
    await t.service.tick();
    expect(t.sent.map((message) => message.data.approvalId)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("keeps an approval unpushed while Expo is down, then sends it once", async () => {
    const t = await setup();
    await t.add("a");
    t.control.send = async (messages) => {
      throw outage(messages);
    };
    await t.service.tick();
    expect(t.approvals.unpushed().map((item) => item.id)).toEqual(["a"]);
    t.control.send = undefined;
    await t.service.tick();
    await t.service.tick();
    expect(t.sent.map((message) => message.data.approvalId)).toEqual(["a"]);
    expect(t.approvals.unpushed()).toEqual([]);
  });

  it("retries only the phone Expo refused", async () => {
    const t = await setup();
    const other = "ExponentPushToken[zzzzzzzzzz789]";
    await t.db.prepare("INSERT INTO devices VALUES (?, ?, ?)").run("phone2", "phone2", "phone2");
    await t.store.register("phone2", parsePushRegistration({ ...registration, pushToken: other }));
    await t.add("a");
    const calls: string[][] = [];
    t.control.send = async (messages) => {
      calls.push(messages.map((message) => message.to));
      return calls.length === 1
        ? { unregistered: [], failed: 1, retry: messages.filter((message) => message.to === other) }
        : { unregistered: [], failed: 0 };
    };
    await t.service.tick();
    await t.service.tick();
    await t.service.tick();
    expect(calls).toHaveLength(2);
    expect(calls[0].sort()).toEqual([registration.pushToken, other].sort());
    expect(calls[1]).toEqual([other]);
    expect(t.approvals.unpushed()).toEqual([]);
  });

  it("does not replay an approval with an unknown outcome, but sends the unsent later phone", async () => {
    const t = await setup();
    const other = "ExponentPushToken[zzzzzzzzzz789]";
    await t.db.prepare("INSERT INTO devices VALUES (?, ?, ?)").run("phone2", "phone2", "phone2");
    await t.store.register("phone2", parsePushRegistration({ ...registration, pushToken: other }));
    await t.add("a");
    const calls: string[][] = [];
    t.control.send = async (messages) => {
      calls.push(messages.map((message) => message.to));
      // The first phone's request failed in flight (unknown); the other phone's batch was never sent.
      if (calls.length === 1)
        throw new ExpoPushError("fetch failed", {
          unregistered: [],
          failed: 0,
          retry: messages.filter((message) => message.to === other),
        });
      return { unregistered: [], failed: 0 };
    };
    await t.service.tick();
    await t.service.tick();
    await t.service.tick();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual([other]);
    expect(t.approvals.unpushed()).toEqual([]);
  });

  it("stops retrying an approval after the retry window", async () => {
    let now = 1_000;
    const t = await setup();
    const service = new PushNotifications({
      store: t.store,
      approvals: t.approvals,
      environmentId: "env-1",
      sessions: async () => [],
      now: () => now,
      send: async (messages) => {
        t.sent.push(...messages);
        throw outage(messages);
      },
    });
    await t.add("a");
    await service.tick();
    now += 16 * 60_000;
    await service.tick();
    expect(t.sent).toHaveLength(2);
    expect(t.approvals.unpushed()).toEqual([]);
    await service.tick();
    expect(t.sent).toHaveLength(2);
  });

  it("still pushes approvals when the session events cannot be delivered", async () => {
    const t = await setup();
    const running = {
      id: "s1",
      projectId: "p1",
      title: "Private title",
      harness: "claude",
      status: "running",
      updatedAt: 1,
    } as HostSessionSummary;
    t.control.sessions = [running];
    await t.service.tick();
    t.control.sessions = [{ ...running, status: "idle" }];
    await t.add("a");
    const delivered: string[] = [];
    t.control.send = async (messages) => {
      if (messages.some((message) => message.data.kind === "finished")) throw outage(messages);
      delivered.push(...messages.map((message) => message.data.kind));
      return { unregistered: [], failed: 0 };
    };
    await t.service.tick();
    expect(delivered).toEqual(["approval"]);
    t.control.send = undefined;
    await t.service.tick();
    expect(t.sent.map((message) => message.data.kind)).toEqual(["finished"]);
  });

  it("does not push approvals that need the computer", async () => {
    const t = await setup();
    await t.add("secret", false);
    await t.service.tick();
    expect(t.sent).toEqual([]);
  });

  it("waits while the desktop is in use, then pushes", async () => {
    const t = await setup();
    t.service.desktopPresence("window", true);
    await t.add("a");
    await t.service.tick();
    expect(t.sent).toEqual([]);
    t.service.desktopPresence("window", false);
    await t.service.tick();
    expect(t.sent).toHaveLength(1);
  });

  it("skips a phone with approval pushes off and defaults old records to on", async () => {
    const off = await setup({ events: { ...registration.events, approvals: false } });
    await off.add("a");
    await off.service.tick();
    expect(off.sent).toEqual([]);

    const t = await setup();
    const row = await t.db.prepare("SELECT settings FROM push_devices").get();
    const old = JSON.parse(String(row?.settings));
    delete old.events.approvals;
    delete old.texts.approvals;
    await t.db.prepare("UPDATE push_devices SET settings=?").run(JSON.stringify(old));
    const [recipient] = await t.store.recipients();
    expect(recipient.events.approvals).toBe(true);
    expect(recipient.texts.approvals).toBeTruthy();
  });
});
