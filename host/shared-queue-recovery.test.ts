import { StoreDatabase } from "./store-db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionQueues } from "./session-queue";
import {
  SharedQueueClient,
  type QueueTransport,
} from "../src/features/connections/model/sharedQueueClient";
import {
  enqueueRemoteMessage,
  reorderRemoteMessages,
} from "../src/features/connections/model/remoteQueue";

const databases: StoreDatabase[] = [];
const row = (id: string) => ({ id, text: id, attachments: [] });
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    key: (index: number) => [...storage.keys()][index],
    get length() {
      return storage.size;
    },
  });
});
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close();
});
function setup() {
  const db = new StoreDatabase(":memory:");
  databases.push(db);
  let queues = new SessionQueues(db);
  let offline = false;
  let loseClaim = false;
  const calls: string[] = [];
  const request: QueueTransport = async (method, params) => {
    calls.push(method);
    if (offline) throw new Error("offline");
    const id = String(params.sessionId);
    if (method.endsWith(".claim")) {
      expect(
        [...Array(localStorage.length)]
          .map((_, index) => localStorage.key(index))
          .some(
            (key) =>
              key?.endsWith(":send") && JSON.parse(localStorage.getItem(key)!).accepted === false,
          ),
      ).toBe(true);
    }
    const action = method.slice(method.lastIndexOf(".") + 1) as Parameters<
      SessionQueues["serve"]
    >[0];
    const result = await queues.serve(action, id, String(params.clientId), params, {
      before: params.before,
      after: params.after,
    });
    if (method.endsWith(".claim") && loseClaim) throw new Error("claim response lost");
    return result as never;
  };
  const client = (id: string) =>
    new SharedQueueClient(
      "machine",
      "environment",
      "chat",
      id,
      request,
      vi.fn(async (_machine, attachments) => attachments),
    );
  return {
    client,
    get queues() {
      return queues;
    },
    restart: () => {
      queues = new SessionQueues(db);
    },
    calls,
    offline: (value: boolean) => {
      offline = value;
    },
    loseClaim: () => {
      loseClaim = true;
    },
  };
}

it("retains unknown delivery without a legacy backup and retries cannot acknowledge it", async () => {
  const f = setup();
  const original = f.client("desktop:old");
  await original.initialize({ messages: [row("a"), row("b")], status: "active" });
  await original.claim("a", false);
  // A restarted window keeps its identity; a different window must not adopt
  // this window's journal from the shared origin.
  const restored = f.client("desktop:old");
  await restored.initialize();
  expect(restored.snapshot().recovery).toBe("a");
  expect(restored.canDrain()).toBe(false);
  await expect(restored.retry()).rejects.toThrow(/unknown/);
  expect((await f.queues.get("chat")).messages.map((message) => message.id)).toEqual(["a", "b"]);
  expect(f.calls.some((method) => method.endsWith(".finish"))).toBe(false);
  await restored.resolveRecovery(false);
  expect(await f.queues.get("chat")).toMatchObject({
    status: "paused",
    drain: { holder: "desktop:old" },
  });
  expect((await f.queues.get("chat")).claim).toBeUndefined();
  expect(restored.snapshot().recovery).toBeUndefined();
  expect((await f.queues.get("chat")).messages.map((message) => message.id)).toEqual(["a", "b"]);
});

it("explicitly confirms delivery while keeping unrelated queued work paused", async () => {
  const f = setup();
  const original = f.client("desktop:old");
  await original.initialize({ messages: [row("a"), row("b")], status: "active" });
  await original.claim("a", false);
  const restored = f.client("desktop:old");
  await restored.initialize({ messages: [] });
  await restored.resolveRecovery(true);
  expect((await f.queues.get("chat")).messages.map((message) => message.id)).toEqual(["b"]);
  expect((await f.queues.get("chat")).status).toBe("paused");
});

it("does not let another window adopt or settle an in-flight send", async () => {
  const f = setup();
  const original = f.client("desktop:old");
  await original.initialize({ messages: [row("a")], status: "active" });
  const token = await original.claim("a", false);
  expect(token).toBeTruthy();
  const other = f.client("desktop:new");
  await other.initialize();
  expect(other.snapshot().recovery).toBeUndefined();
  expect(other.canDrain()).toBe(false);
  await other.resolveRecovery(true);
  expect((await f.queues.get("chat")).claim?.token).toBe(token);
  expect((await f.queues.get("chat")).messages.map((message) => message.id)).toEqual(["a"]);
  expect(f.calls.some((method) => method.endsWith(".finish"))).toBe(false);
});

it("reconciles a lost claim reply after client and queue-service restart without sending", async () => {
  const f = setup();
  const original = f.client("desktop:old");
  await original.initialize({ messages: [row("a")], status: "active" });
  f.loseClaim();
  await expect(original.claim("a", false)).rejects.toThrow("claim response lost");
  f.restart();
  const restored = f.client("desktop:old");
  await restored.initialize();
  expect(await f.queues.get("chat")).toMatchObject({
    messages: [row("a")],
    // Only the claim reply was lost: no provider send started, so the queue
    // keeps its active state after releasing that reservation.
    status: "active",
    drain: { holder: "desktop:old" },
  });
  expect((await f.queues.get("chat")).claim).toBeUndefined();
  expect(restored.snapshot().error).toBeUndefined();
  expect(restored.snapshot().recovery).toBeUndefined();
  expect(restored.canDrain()).toBe(true);
  expect(f.calls.filter((method) => method.endsWith(".claim"))).toHaveLength(1);
});

it("preserves offline append-and-reorder and unrelated concurrent rows through reconnect", async () => {
  const f = setup();
  const original = f.client("remote:old");
  await original.initialize({ messages: [row("a")], status: "paused" });
  f.offline(true);
  original.update((queue) => enqueueRemoteMessage(queue, row("b")));
  original.update((queue) => reorderRemoteMessages(queue, ["b", "a"]));
  await expect(original.sync()).rejects.toThrow("offline");
  const current = await f.queues.get("chat");
  await f.queues.change("chat", current, { ...current, messages: [...current.messages, row("c")] });
  f.offline(false);
  const restored = f.client("remote:new");
  await restored.initialize();
  expect((await f.queues.get("chat")).messages.map((message) => message.id)).toEqual([
    "b",
    "a",
    "c",
  ]);
  expect(restored.snapshot().queue.messages.map((message) => message.id)).toEqual(["b", "a", "c"]);
});
