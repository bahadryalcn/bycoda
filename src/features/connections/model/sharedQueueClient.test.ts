// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { SharedQueueClient, type QueueTransport } from "./sharedQueueClient";
import { mergeQueueChange, type SharedQueue } from "./sharedQueue";
import { recordRemoteCapabilities } from "./connections";
import { ATTACHMENT_OWNERSHIP_CAPABILITY, attachmentOwnershipScope } from "./attachmentOwnership";
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(async (command: string) =>
    command === "session_attachment_references" ? { draftIds: [], queues: {} } : undefined,
  ),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
  getAllWindows: async () => [{ label: "main" }],
}));
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

it("atomically claims host-owned queue views on every reply and releases only after durable consume", async () => {
  recordRemoteCapabilities("managed-view-host", [ATTACHMENT_OWNERSHIP_CAPABILITY]);
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  let queue: SharedQueue = {
    revision: 1,
    consumer: "remote:managed-view",
    messages: [
      {
        id: "row",
        text: "queued",
        attachments: [
          {
            id: "host-file",
            name: "a.txt",
            kind: "file",
            mimeType: "text/plain",
            size: 1,
            hostEnvironmentId: "managed-view-host",
          },
        ],
      },
    ],
  };
  const request: QueueTransport = async (method, params) => {
    calls.push({ method, params });
    if (method === "attachments.claims") return { claims: [] } as never;
    if (method === "sessions.queue.claim")
      queue = { ...queue, claim: { id: "row", clientId: "remote:managed-view", token: "held" } };
    if (method === "sessions.queue.finish") queue = { ...queue, claim: undefined, messages: [] };
    return structuredClone(queue) as never;
  };
  const client = new SharedQueueClient(
    "managed-view-machine",
    "managed-view-host",
    "managed-view-session",
    "remote:managed-view",
    request,
    vi.fn(async (_machine, files) => files),
  );
  await client.initialize();
  const snapshot = client.snapshot();
  expect(snapshot.queue.messages[0].attachments[0].id).toBe("host-file");
  expect(calls[0]).toMatchObject({
    method: "sessions.queue.get",
    params: { ownerId: expect.any(String), claimId: expect.any(String) },
  });
  const token = await client.claim("row", false);
  expect(token).toBe("held");
  expect(calls.some((call) => call.method === "attachments.release")).toBe(false);
  await client.finish(token!, true);
  await vi.waitFor(() =>
    expect(calls.some((call) => call.method === "attachments.release")).toBe(true),
  );
  for (const call of calls.filter((call) => call.method.startsWith("sessions.queue.")))
    expect(call.params).toMatchObject({ ownerId: expect.any(String), claimId: expect.any(String) });
});

it("hands closed-window queue claims to durable global drafts and retires them after that draft clears", async () => {
  recordRemoteCapabilities("closed-queue-host", [ATTACHMENT_OWNERSHIP_CAPABILITY]);
  let draftIds = ["exported-file"];
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "session_attachment_references" ? { draftIds, queues: {} } : undefined,
  );
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const request: QueueTransport = async (method, params) => {
    calls.push({ method, params });
    return (
      method === "attachments.claims" ? { claims: [] } : { messages: [], revision: 0 }
    ) as never;
  };
  const oldOwner = JSON.stringify(["desktop-queue", "closed-queue-session", "closed-window"]);
  await attachmentOwnershipScope(
    "closed-queue-machine",
    "closed-queue-host",
    oldOwner,
    request,
  ).acquire("cache", ["exported-file"]);
  const client = new SharedQueueClient(
    "closed-queue-machine",
    "closed-queue-host",
    "closed-queue-session",
    "remote:closed",
    request,
    vi.fn(async (_machine, files) => files),
  );
  try {
    await client.initialize();
    await vi.waitFor(() =>
      expect(
        calls.some(
          (call) => call.method === "attachments.release" && call.params.ownerId === oldOwner,
        ),
      ).toBe(true),
    );
    const newClaim = calls.find(
      (call) => call.method === "attachments.claim" && call.params.ownerId !== oldOwner,
    );
    expect(newClaim?.params.ids).toEqual(["exported-file"]);
    expect(
      calls.some(
        (call) =>
          call.method === "attachments.release" && call.params.ownerId === newClaim?.params.ownerId,
      ),
    ).toBe(false);
    draftIds = [];
    await client.sync();
    await vi.waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === "attachments.release" &&
            call.params.ownerId === newClaim?.params.ownerId,
        ),
      ).toBe(true),
    );
  } finally {
    vi.mocked(invoke).mockImplementation(original);
  }
});
