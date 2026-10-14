// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { SharedQueueClient, type QueueTransport } from "./sharedQueueClient";
import { mergeQueueChange, type SharedQueue } from "./sharedQueue";
import {
  editRemoteMessage,
  enqueueRemoteMessage,
  removeRemoteMessage,
  reorderRemoteMessages,
} from "./remoteQueue";

const message = (id: string, text = id) => ({ id, text, attachments: [] });
beforeEach(() => localStorage.clear());
function fixture() {
  let queue: SharedQueue = { messages: [], revision: 0 };
  let offline = false;
  const request: QueueTransport = async (method, params) => {
    if (offline) throw new Error("offline");
    if (method.endsWith(".change")) {
      queue = {
        ...mergeQueueChange(queue, {
          before: params.before as SharedQueue,
          after: params.after as SharedQueue,
          consumer: params.takeOwnership ? String(params.clientId) : undefined,
        }),
        revision: queue.revision + 1,
      };
    }
    if (method.endsWith(".claim"))
      queue = {
        ...queue,
        revision: queue.revision + 1,
        claim: { id: String(params.id), clientId: String(params.clientId), token: "token" },
      };
    if (method.endsWith(".finish"))
      queue = {
        ...queue,
        revision: queue.revision + 1,
        messages: params.accepted
          ? queue.messages.filter((row) => row.id !== queue.claim?.id)
          : queue.messages,
        claim: undefined,
      };
    return structuredClone(queue) as never;
  };
  const upload = vi.fn(async (_machine, attachments) => attachments);
  const client = (id: string, session = "chat", environment = "host") =>
    new SharedQueueClient("machine", environment, session, id, request, upload);
  return {
    client,
    queue: () => queue,
    offline: (value: boolean) => {
      offline = value;
    },
    replace: (value: SharedQueue) => {
      queue = value;
    },
    upload,
  };
}

it("shows queued messages on another computer and shares edits, order and deletion", async () => {
  const f = fixture();
  const a = f.client("remote:a");
  const b = f.client("remote:b");
  await a.initialize();
  await b.initialize();
  a.update((queue) => enqueueRemoteMessage(queue, message("a")));
  a.update((queue) => enqueueRemoteMessage(queue, message("b")));
  await a.sync();
  await b.sync();
  expect(b.snapshot().queue.messages.map((row) => row.id)).toEqual(["a", "b"]);
  expect(a.canDrain()).toBe(true);
  expect(b.canDrain()).toBe(false);
  b.update((queue) => editRemoteMessage(queue, "a", "edited on pc2", []));
  b.update((queue) => reorderRemoteMessages(queue, ["b", "a"]));
  await b.sync();
  await a.sync();
  expect(a.snapshot().queue.messages.map((row) => row.text)).toEqual(["b", "edited on pc2"]);
  b.update((queue) => removeRemoteMessage(queue, "b"));
  await b.sync();
  await a.sync();
  expect(a.snapshot().queue.messages).toEqual([message("a", "edited on pc2")]);
});

it("retains offline changes across a remount and applies them after reconnect", async () => {
  const f = fixture();
  const a = f.client("remote:a");
  await a.initialize();
  f.offline(true);
  a.update((queue) => enqueueRemoteMessage(queue, message("offline")));
  await expect(a.sync()).rejects.toThrow("offline");
  expect(a.canDrain()).toBe(false);
  const restored = f.client("remote:new");
  f.offline(false);
  await restored.initialize();
  expect(f.queue().messages).toEqual([message("offline")]);
  expect(restored.canDrain()).toBe(true);
});

it("preserves a conflicting edit as a paused copy when the user retries", async () => {
  const f = fixture();
  const a = f.client("remote:a");
  const b = f.client("remote:b");
  await a.initialize({ messages: [message("a")], status: "active" });
  await b.initialize();
  a.update((queue) => editRemoteMessage(queue, "a", "first", []));
  await a.sync();
  b.update((queue) => editRemoteMessage(queue, "a", "second", []));
  await expect(b.sync()).rejects.toThrow(/another computer/);
  expect(b.snapshot().queue.messages[0].text).toBe("second");
  await b.retry();
  expect(f.queue().messages.map((row) => row.text)).toEqual(["first", "second"]);
  expect(f.queue().status).toBe("paused");
});

it("does not import stale backups into an already consumed host queue", async () => {
  const f = fixture();
  f.replace({ messages: [], revision: 12 });
  const a = f.client("remote:a");
  await a.initialize({ messages: [message("stale")], status: "restored" });
  expect(a.snapshot().queue.messages).toEqual([]);
});

it("restores unpublished local rows from the durable baseline without resurrecting a consumed row", async () => {
  const f = fixture();
  const a = f.client("desktop:a");
  await a.initialize({ messages: [message("consumed")], status: "active" });
  f.replace({ ...f.queue(), messages: [], status: undefined, revision: f.queue().revision + 1 });
  const restored = f.client("desktop:new");
  await restored.initialize({
    messages: [message("consumed"), message("offline-new")],
    status: "restored",
  });
  expect(f.queue().messages).toEqual([message("offline-new")]);
  expect(f.queue().status).toBe("restored");
});

it("keeps host and session identities separate in its durable outbox", async () => {
  const f = fixture();
  const a = f.client("remote:a", "chat", "one");
  await a.initialize();
  f.offline(true);
  a.update((queue) => enqueueRemoteMessage(queue, message("one")));
  await expect(a.sync()).rejects.toThrow();
  const other = f.client("remote:b", "chat", "two");
  f.offline(false);
  await other.initialize();
  expect(other.snapshot().queue.messages).toEqual([]);
});

it("recovers an acknowledged desktop send after a lost finish response", async () => {
  const f = fixture();
  const a = f.client("desktop:a");
  await a.initialize({ messages: [message("a")], status: "active" });
  const token = await a.claim("a", false);
  f.offline(true);
  await expect(a.finish(token!, true)).rejects.toThrow();
  const restored = f.client("desktop:new");
  f.offline(false);
  await restored.initialize();
  expect(restored.snapshot().queue.messages).toEqual([]);
});
