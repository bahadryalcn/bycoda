import { afterEach, describe, expect, it } from "vitest";
import { ownerApprovalSignature } from "../../src/shared/model/ownerApprovalSignature";
import { ApprovalRegistry } from "../approvals/approval-registry";
import { StoreDatabase } from "../store-db";
import type { ExpoPushMessage } from "./expo-push";
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
  const service = new PushNotifications({
    store,
    approvals,
    environmentId: "env-1",
    sessions: async () => [],
    send: async (messages) => {
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
  return { db, store, approvals, sent, service, add };
}

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
