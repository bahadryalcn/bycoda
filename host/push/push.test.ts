import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostSessionSummary } from "../../src/features/connections/model/protocol";
import { StoreDatabase } from "../store-db";
import { EXPO_PUSH_URL, sendExpoPush, type ExpoPushMessage } from "./expo-push";
import { detectPushEvents } from "./push-events";
import { DESKTOP_PRESENCE_MS, PushNotifications } from "./push-service";
import { parsePushRegistration, PushDeviceStore } from "./push-store";

const TOKEN = "ExponentPushToken[abcdefghij123]";
const registration = {
  pushToken: TOKEN,
  platform: "android",
  title: "bycoda · Home PC",
  texts: { finished: "Agent finished", input: "Needs your input", failed: "Turn failed" },
  events: { finished: true, input: true, failed: true },
};

function session(id: string, patch: Partial<HostSessionSummary> = {}): HostSessionSummary {
  return {
    id,
    projectId: "p1",
    title: "Private title",
    harness: "claude",
    status: "idle",
    updatedAt: 1,
    ...patch,
  } as HostSessionSummary;
}

const databases: StoreDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close();
});

async function storeWithDevices(...hashes: string[]) {
  const db = new StoreDatabase(":memory:");
  databases.push(db);
  await db.exec(
    "CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE)",
  );
  for (const hash of hashes)
    await db.prepare("INSERT INTO devices VALUES (?, ?, ?)").run(hash, hash, hash);
  return { db, store: new PushDeviceStore(db) };
}

describe("detectPushEvents", () => {
  it("only records a baseline on the first read", () => {
    const { events } = detectPushEvents(undefined, [session("a", { needsInput: true })]);
    expect(events).toEqual([]);
  });

  it("reports input, failure and finish transitions once", () => {
    const first = detectPushEvents(undefined, [
      session("a", { status: "running" }),
      session("b", { status: "running" }),
      session("c", { status: "running" }),
      session("d", { status: "running" }),
    ]).next;
    const second = detectPushEvents(first, [
      session("a", { status: "idle" }),
      session("b", { status: "running", needsInput: true }),
      session("c", { status: "idle", issue: "failed", issueTurnId: "t1" }),
      session("d", { status: "interrupted" }),
    ]);
    expect(second.events).toEqual([
      { kind: "finished", sessionId: "a", projectId: "p1" },
      { kind: "input", sessionId: "b", projectId: "p1" },
      { kind: "failed", sessionId: "c", projectId: "p1" },
    ]);
    const third = detectPushEvents(second.next, [
      session("a"),
      session("b", { status: "running", needsInput: true }),
      session("c", { issue: "failed", issueTurnId: "t1" }),
      session("d", { status: "interrupted" }),
    ]);
    expect(third.events).toEqual([]);
  });

  it("treats a new conversation as idle and skips children, drafts and archived rows", () => {
    const { events } = detectPushEvents(new Map(), [
      session("new", { needsInput: true }),
      session("child", {
        needsInput: true,
        delegationParent: { parentSessionId: "new" } as HostSessionSummary["delegationParent"],
      }),
      session("draft", { needsInput: true, draft: true }),
      session("archived", { needsInput: true, archived: true }),
    ]);
    expect(events.map((event) => event.sessionId)).toEqual(["new"]);
  });
});

describe("parsePushRegistration", () => {
  it("accepts a valid registration and strips control characters", () => {
    const parsed = parsePushRegistration({ ...registration, title: "bycoda\n PC" });
    expect(parsed.title).toBe("bycoda  PC");
    expect(parsed.events).toEqual({ finished: true, input: true, failed: true });
  });

  it.each([
    { pushToken: "not-a-token" },
    { platform: "web" },
    { title: "" },
    { title: "x".repeat(121) },
    { texts: { finished: "a", input: "b" } },
  ])("rejects %o", (patch) => {
    expect(() => parsePushRegistration({ ...registration, ...patch })).toThrow();
  });
});

describe("PushDeviceStore", () => {
  it("returns only phones whose pairing still exists", async () => {
    const { db, store } = await storeWithDevices("phone");
    await store.register("phone", parsePushRegistration(registration));
    await store.register(
      "revoked",
      parsePushRegistration({ ...registration, pushToken: "ExpoPushToken[zzzzzzzzzz]" }),
    );
    expect((await store.recipients()).map((row) => row.deviceHash)).toEqual(["phone"]);
    await db.prepare("DELETE FROM devices WHERE hash=?").run("phone");
    expect(await store.recipients()).toEqual([]);
  });

  it("moves a push token to the phone's new pairing", async () => {
    const { store } = await storeWithDevices("old", "new");
    await store.register("old", parsePushRegistration(registration));
    await store.register("new", parsePushRegistration(registration));
    expect((await store.recipients()).map((row) => row.deviceHash)).toEqual(["new"]);
    expect(await store.unregister("new")).toBe(true);
    expect(await store.recipients()).toEqual([]);
  });
});

describe("sendExpoPush", () => {
  const message: ExpoPushMessage = {
    to: TOKEN,
    title: "t",
    body: "b",
    data: {},
    sound: "default",
    channelId: "bycoda",
    priority: "high",
  };

  it("reports unregistered tokens and other refusals", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      Response.json({
        data: [
          { status: "ok", id: "1" },
          { status: "error", details: { error: "DeviceNotRegistered" } },
          { status: "error", details: { error: "MessageRateExceeded" } },
        ],
      }),
    );
    const result = await sendExpoPush(
      [message, { ...message, to: "gone" }, message],
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({ unregistered: ["gone"], failed: 1 });
    expect(fetchImpl.mock.calls[0][0]).toBe(EXPO_PUSH_URL);
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws when Expo rejects the request", async () => {
    const fetchImpl = async () => new Response("down", { status: 503 });
    await expect(sendExpoPush([message], fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      "503",
    );
  });
});

describe("PushNotifications", () => {
  async function setup(events = registration.events) {
    const { store } = await storeWithDevices("phone");
    await store.register("phone", parsePushRegistration({ ...registration, events }));
    let sessions = [session("a", { status: "running" })];
    let time = 1_000;
    const sent: ExpoPushMessage[][] = [];
    const service = new PushNotifications({
      store,
      environmentId: "env-1",
      sessions: async () => sessions,
      now: () => time,
      send: async (messages) => {
        sent.push([...messages]);
        return { unregistered: [], failed: 0 };
      },
    });
    await service.tick();
    return {
      service,
      store,
      sent,
      finish: () => {
        sessions = [session("a", { status: "idle" })];
      },
      advance: (ms: number) => {
        time += ms;
      },
    };
  }

  it("sends the phone's own text without conversation names", async () => {
    const { service, sent, finish } = await setup();
    finish();
    await service.tick();
    expect(sent).toEqual([
      [
        {
          to: TOKEN,
          title: "bycoda · Home PC",
          body: "Agent finished",
          data: { kind: "finished", sessionId: "a", projectId: "p1", environmentId: "env-1" },
          sound: "default",
          channelId: "bycoda",
          priority: "high",
        },
      ],
    ]);
    expect(JSON.stringify(sent)).not.toContain("Private title");
  });

  it("holds pushes while the desktop app is in use, until its presence expires", async () => {
    const { service, sent, finish, advance } = await setup();
    service.desktopPresence("window", true);
    finish();
    await service.tick();
    expect(sent).toEqual([]);
    expect(service.desktopActive()).toBe(true);
    advance(DESKTOP_PRESENCE_MS + 1);
    expect(service.desktopActive()).toBe(false);
  });

  it("respects the phone's event choices", async () => {
    const { service, sent, finish } = await setup({ finished: false, input: true, failed: true });
    finish();
    await service.tick();
    expect(sent).toEqual([]);
  });

  it("forgets a token Expo reports as unregistered", async () => {
    const { store } = await storeWithDevices("phone");
    await store.register("phone", parsePushRegistration(registration));
    const service = new PushNotifications({
      store,
      environmentId: "env-1",
      sessions: async () => [],
      send: async (messages) => ({ unregistered: messages.map((m) => m.to), failed: 0 }),
    });
    expect(await service.test("phone", "Test")).toBe(true);
    expect(await store.recipients()).toEqual([]);
    expect(await service.test("phone", "Test")).toBe(false);
  });
});
