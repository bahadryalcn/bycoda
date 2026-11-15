import { afterEach, describe, expect, it } from "vitest";
import { StoreDatabase } from "../store-db";
import type { ExpoPushMessage } from "./expo-push";
import { createSocialPushSource, SocialPushLedger, type SocialPushItem } from "./push-social";
import { PushNotifications } from "./push-service";
import { parsePushRegistration, PushDeviceStore } from "./push-store";

const registration = {
  pushToken: "ExponentPushToken[abcdefghij123]",
  platform: "android",
  title: "bycoda · Home PC",
  texts: { finished: "Agent finished", input: "Needs your input", failed: "Turn failed" },
  events: { finished: true, input: true, failed: true },
};
const NOW = 1_800_000_000_000;

const databases: StoreDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close();
});

const item = (id: string, over: Partial<SocialPushItem> = {}): SocialPushItem => ({
  id,
  kind: "accountRequest",
  platform: "x",
  at: NOW - 1000,
  ...over,
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
  let waiting: SocialPushItem[] = [];
  const sent: ExpoPushMessage[] = [];
  const create = () =>
    new PushNotifications({
      store,
      environmentId: "env-1",
      sessions: async () => [],
      social: async () => waiting,
      socialLedger: new SocialPushLedger(db),
      wallNow: () => NOW,
      send: async (messages) => {
        sent.push(...messages);
        return { unregistered: [], failed: 0 };
      },
    });
  return { sent, create, set: (items: SocialPushItem[]) => (waiting = items) };
}

describe("social pushes", () => {
  it("sends one push per item and phone, again only for a new id, also after a restart", async () => {
    const t = await setup();
    t.set([item("request:1")]);
    await t.create().tick();
    await t.create().tick();
    expect(t.sent).toHaveLength(1);
    t.set([item("request:1"), item("signin:a:5", { kind: "signIn" })]);
    await t.create().tick();
    expect(t.sent).toHaveLength(2);
  });

  it("carries the platform and reason only, with the recipient's own text", async () => {
    const t = await setup();
    t.set([item("human:1", { kind: "needsHuman", platform: "linkedin", reason: "challenge" })]);
    await t.create().tick();
    expect(t.sent[0]).toMatchObject({
      title: "bycoda · Home PC",
      body: "Needs your input",
      data: {
        kind: "input",
        social: "needsHuman",
        platform: "LinkedIn",
        reason: "challenge",
        environmentId: "env-1",
      },
    });
    expect(JSON.stringify(t.sent[0])).not.toMatch(/project|account name/i);
  });

  it("follows the needs-your-input toggle and the desktop presence", async () => {
    const off = await setup({ events: { ...registration.events, input: false } });
    off.set([item("request:1")]);
    await off.create().tick();
    expect(off.sent).toEqual([]);
    const t = await setup();
    const service = t.create();
    service.desktopPresence("window", true);
    t.set([item("request:1")]);
    await service.tick();
    expect(t.sent).toEqual([]);
  });

  it("skips items older than a day and sends at most three per tick", async () => {
    const t = await setup();
    t.set([
      item("old", { at: NOW - 25 * 3_600_000 }),
      ...["a", "b", "c", "d"].map((id) => item(`request:${id}`)),
    ]);
    const service = t.create();
    await service.tick();
    expect(t.sent).toHaveLength(3);
    await service.tick();
    expect(t.sent).toHaveLength(4);
  });
});

describe("social push source", () => {
  it("reads pending requests, waiting browser tasks and expired accounts as the owner", async () => {
    const account = (id: string, over: Record<string, unknown>) => ({
      id,
      platform: "x",
      connected: true,
      paused: false,
      grants: {},
      ...over,
    });
    const source = createSocialPushSource(
      {
        call: async (_principal: unknown, action: string) =>
          action === "accounts.requests.list"
            ? {
                items: [
                  { id: "r1", platform: "x", status: "pending", createdAt: 5 },
                  { id: "r2", platform: "x", status: "dismissed", createdAt: 5 },
                ],
              }
            : { items: [{ id: "h1", platform: "linkedin", reason: "login", at: 7 }] },
        accounts: async () => [
          account("b1", { connection: "browser", expiresAt: NOW - 10 }),
          account("o1", { expiresAt: NOW - 60_000 }),
          account("o2", { expiresAt: NOW - 16 * 60_000 }),
          account("p1", { connection: "browser", expiresAt: 1, paused: true }),
        ],
      } as never,
      () => NOW,
    );
    expect((await source()).map((entry) => entry.id)).toEqual([
      "request:r1",
      "human:h1",
      `signin:b1:${NOW - 10}`,
      `signin:o2:${NOW - 16 * 60_000}`,
    ]);
  });
});
