import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostSessionSummary } from "../../src/features/connections/model/protocol";
import { StoreDatabase } from "../store-db";
import { EXPO_PUSH_URL, ExpoPushError, sendExpoPush, type ExpoPushMessage } from "./expo-push";
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
    expect(parsed.events).toEqual({
      finished: true,
      input: true,
      failed: true,
      assistant: true,
      approvals: true,
    });
    expect(parsed.assistantUrgentDuringQuiet).toBe(true);
    expect(parsed.texts.assistant).toBeTruthy();
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
    // A throttled message was certainly not delivered, so it may be retried.
    expect(result).toEqual({ unregistered: ["gone"], failed: 1, retry: [message] });
    expect(fetchImpl.mock.calls[0][0]).toBe(EXPO_PUSH_URL);
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws when Expo rejects the request", async () => {
    const fetchImpl = async () => new Response("down", { status: 503 });
    await expect(sendExpoPush([message], fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      "503",
    );
  });

  const many = Array.from({ length: 101 }, (_, index) => ({ ...message, to: `token-${index}` }));
  const accepted = () => Response.json({ data: Array.from({ length: 100 }, () => ({ status: "ok" })) });
  const failure = (run: Promise<unknown>) => run.catch((caught: unknown) => caught as ExpoPushError);

  it("keeps an ambiguous 5xx batch out of retry and lists only the later unsent batch", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(new Response("down", { status: 503 }));
    const error = await failure(sendExpoPush(many, fetchImpl as unknown as typeof fetch));
    expect(error).toBeInstanceOf(ExpoPushError);
    // The first 100 were accepted and the 503 may have been processed: nothing of the 101 is owed.
    expect((error as ExpoPushError).partial.retry).toEqual([]);

    const later = vi
      .fn()
      .mockResolvedValueOnce(new Response("down", { status: 502 }))
      .mockResolvedValueOnce(accepted());
    const unsent = await failure(sendExpoPush([...many, ...many], later as unknown as typeof fetch));
    // Batch one is ambiguous; the batches never sent are still owed, and only they.
    expect((unsent as ExpoPushError).partial.retry).toEqual([...many, ...many].slice(100));
    expect(later).toHaveBeenCalledTimes(1);
  });

  it("never retries a network failure or a deadline, which may have been accepted", async () => {
    const offline = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const down = await failure(sendExpoPush(many, offline as unknown as typeof fetch));
    // Only the batch never sent (index 100) is owed; the 100 that failed in flight are unknown.
    expect((down as ExpoPushError).partial.retry).toEqual(many.slice(100));
    const timeout = vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    const late = await failure(sendExpoPush([message], timeout as unknown as typeof fetch));
    expect((late as ExpoPushError).partial.retry).toEqual([]);
  });

  it("retries an explicitly throttled request with the batches never sent, and never an invalid one", async () => {
    const throttled = vi.fn().mockResolvedValue(new Response("slow", { status: 429 }));
    const slow = await failure(sendExpoPush(many, throttled as unknown as typeof fetch));
    expect((slow as ExpoPushError).partial.retry).toEqual(many);
    const invalid = vi.fn().mockResolvedValue(new Response("bad", { status: 400 }));
    const refused = await failure(sendExpoPush([message], invalid as unknown as typeof fetch));
    expect((refused as ExpoPushError).partial.retry).toEqual([]);
  });

  it("does not retry an accepted request whose response cannot be read", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    const error = await sendExpoPush([message], fetchImpl as unknown as typeof fetch).catch(
      (caught: unknown) => caught as ExpoPushError,
    );
    expect((error as ExpoPushError).partial.retry).toEqual([]);
  });

  it("flags outages as unreachable, but not a request Expo called invalid", async () => {
    const down = await failure(
      sendExpoPush([message], vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch),
    );
    const serverError = await failure(
      sendExpoPush([message], vi.fn().mockResolvedValue(new Response("down", { status: 503 })) as unknown as typeof fetch),
    );
    const throttled = await failure(
      sendExpoPush([message], vi.fn().mockResolvedValue(new Response("slow", { status: 429 })) as unknown as typeof fetch),
    );
    const invalid = await failure(
      sendExpoPush([message], vi.fn().mockResolvedValue(new Response("bad", { status: 400 })) as unknown as typeof fetch),
    );
    expect([down, serverError, throttled].map((error) => error.unreachable)).toEqual([true, true, true]);
    expect(invalid.unreachable).toBe(false);
  });
});

describe("PushNotifications", () => {
  it("reports the kinds a registered phone receives, so the desktop does not report them too", async () => {
    const { service } = await setup({ finished: true, input: false, failed: true });
    expect(await service.ownedEvents()).toEqual(["finished", "failed"]);
  });

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

  it("delays a burst beyond the per-tick cap on later ticks instead of dropping it", async () => {
    const { store } = await storeWithDevices("phone");
    await store.register("phone", parsePushRegistration(registration));
    const ids = ["a", "b", "c", "d", "e"];
    let sessions = ids.map((id) => session(id, { status: "running" }));
    const sent: ExpoPushMessage[][] = [];
    const service = new PushNotifications({
      store,
      environmentId: "env-1",
      sessions: async () => sessions,
      now: () => 1_000,
      send: async (messages) => {
        sent.push([...messages]);
        return { unregistered: [], failed: 0 };
      },
    });
    await service.tick();
    sessions = ids.map((id) => session(id, { status: "idle" }));
    await service.tick();
    await service.tick();
    await service.tick();
    expect(sent.map((batch) => batch.length)).toEqual([3, 2]);
    expect(sent.flat().map((message) => message.data.sessionId)).toEqual(ids);
  });

  describe("when Expo cannot take a push", () => {
    /** The whole request was explicitly throttled, so every message is certainly undelivered. */
    const outage = (messages: readonly ExpoPushMessage[]) =>
      new ExpoPushError("Expo push rejected the request (429)", {
        unregistered: [],
        failed: 0,
        retry: [...messages],
      });

    async function finishing(
      send: (messages: readonly ExpoPushMessage[]) => Promise<{ unregistered: string[]; failed: number; retry?: ExpoPushMessage[] }>,
      tokens: string[] = [TOKEN],
    ) {
      const { db, store } = await storeWithDevices(...tokens.map((_, index) => `phone${index}`));
      for (const [index, token] of tokens.entries())
        await store.register(
          `phone${index}`,
          parsePushRegistration({ ...registration, pushToken: token }),
        );
      let sessions = [session("a", { status: "running" })];
      let time = 1_000;
      const service = new PushNotifications({
        store,
        environmentId: "env-1",
        sessions: async () => sessions,
        now: () => time,
        send,
      });
      await service.tick();
      sessions = [session("a", { status: "idle" })];
      return {
        db,
        service,
        advance: (ms: number) => {
          time += ms;
        },
      };
    }

    it("keeps the event and sends it once Expo is back, never twice", async () => {
      const sent: ExpoPushMessage[][] = [];
      let down = true;
      const { service } = await finishing(async (messages) => {
        if (down) throw outage(messages);
        sent.push([...messages]);
        return { unregistered: [], failed: 0 };
      });
      await service.tick();
      expect(sent).toEqual([]);
      down = false;
      await service.tick();
      await service.tick();
      expect(sent.map((batch) => batch.map((message) => message.data.sessionId))).toEqual([["a"]]);
    });

    it("retries only the phone Expo refused, not the one that already got the push", async () => {
      const other = "ExponentPushToken[zzzzzzzzzz789]";
      const calls: ExpoPushMessage[][] = [];
      const { service } = await finishing(async (messages) => {
        calls.push([...messages]);
        // First request: the second phone is throttled; later requests succeed.
        if (calls.length === 1)
          return { unregistered: [], failed: 1, retry: messages.filter((m) => m.to === other) };
        return { unregistered: [], failed: 0 };
      }, [TOKEN, other]);
      calls.length = 0;
      await service.tick();
      await service.tick();
      expect(calls.map((batch) => batch.map((message) => message.to).sort())).toEqual([
        [TOKEN, other].sort(),
        [other],
      ]);
    });

    it("never replays an ambiguous outcome, but sends the later batch that was never sent", async () => {
      const other = "ExponentPushToken[zzzzzzzzzz789]";
      const calls: string[][] = [];
      const { service } = await finishing(async (messages) => {
        calls.push(messages.map((message) => message.to));
        // First request: the first phone's batch has an unknown outcome (network failure); the other
        // phone sits in a later batch that was never sent.
        if (calls.length === 1)
          throw new ExpoPushError("fetch failed", {
            unregistered: [],
            failed: 0,
            retry: messages.filter((message) => message.to === other),
          });
        return { unregistered: [], failed: 0 };
      }, [TOKEN, other]);
      calls.length = 0;
      await service.tick();
      await service.tick();
      await service.tick();
      expect(calls.map((to) => [...to].sort())).toEqual([[TOKEN, other].sort(), [other]]);
    });

    it("never replays a push when the sender fails in an unexpected way", async () => {
      const calls: number[] = [];
      const { service } = await finishing(async () => {
        calls.push(1);
        throw new Error("socket hang up");
      });
      calls.length = 0;
      await service.tick();
      await service.tick();
      await service.tick();
      expect(calls).toHaveLength(1);
    });

    it("does not retry a request Expo called invalid", async () => {
      const calls: number[] = [];
      const { service } = await finishing(async () => {
        calls.push(1);
        throw new ExpoPushError("Expo push rejected the request (400)", {
          unregistered: [],
          failed: 0,
          retry: [],
        });
      });
      calls.length = 0;
      await service.tick();
      await service.tick();
      expect(calls).toHaveLength(1);
    });

    it("drops a push after the retry window instead of delivering it stale", async () => {
      const calls: number[] = [];
      const { service, advance } = await finishing(async (messages) => {
        calls.push(messages.length);
        throw outage(messages);
      });
      calls.length = 0;
      await service.tick();
      advance(16 * 60_000);
      await service.tick();
      await service.tick();
      expect(calls).toEqual([1]);
    });

    it("backs off while Expo is unreachable, doubling the pause, and sends once Expo answers", async () => {
      const calls: number[] = [];
      let down = true;
      const { service, advance } = await finishing(async (messages) => {
        calls.push(messages.length);
        if (down) {
          const error = outage(messages);
          throw new ExpoPushError(error.message, error.partial, true);
        }
        return { unregistered: [], failed: 0 };
      });
      calls.length = 0;
      await service.tick(); // t=1s: first failure, pause 30 s
      await service.tick(); // still paused: no call, the event stays owed
      expect(calls).toEqual([1]);
      advance(30_000);
      await service.tick(); // t=31s: second failure, pause 60 s
      expect(calls).toEqual([1, 1]);
      advance(30_000);
      await service.tick(); // t=61s: still inside the pause
      expect(calls).toEqual([1, 1]);
      advance(30_000);
      down = false;
      await service.tick(); // t=91s: Expo is back, the owed event goes out
      expect(calls).toEqual([1, 1, 1]);
    });

    it("keeps the widget update pending until every phone took it", async () => {
      const { store } = await storeWithDevices("phone");
      await store.register(
        "phone",
        parsePushRegistration({ ...registration, widgetUpdates: true }),
      );
      const widgets: number[] = [];
      let throttled = true;
      const service = new PushNotifications({
        store,
        environmentId: "env-1",
        sessions: async () => [],
        send: async (messages) => {
          widgets.push(messages.length);
          return throttled
            ? { unregistered: [], failed: 1, retry: [...messages] }
            : { unregistered: [], failed: 0 };
        },
      });
      await service.tick();
      throttled = false;
      await service.tick();
      await service.tick();
      expect(widgets).toEqual([1, 1]);
    });
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
